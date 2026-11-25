/**
 * Meeting service. Every exported function takes the authenticated actor and
 * enforces authorization here, on the server — never in the browser.
 */
import { z } from "zod"
import type { PoolClient } from "pg"
import { query, tx } from "./db"
import {
  AppError,
  HR_TEAM_NAME,
  HR_TOPICS,
  MANAGER_TOPICS,
  MIN_REPORTING,
  MODE_LABEL,
  TIMES,
  type Meeting,
  type SessionUser,
  type Initiator,
  type Status,
} from "./types"
import { ALL_TYPES, GUIDES, HR_TYPES, MANAGER_TYPES, typeFromTopics, type MeetingType } from "./guides"

// ---------- helpers ----------

const UB_OFFSET_MS = 8 * 60 * 60 * 1000 // Asia/Ulaanbaatar, no DST

export function todayKey(offsetDays = 0) {
  return new Date(Date.now() + UB_OFFSET_MS + offsetDays * 86_400_000)
    .toISOString()
    .slice(0, 10)
}

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input)
  if (!result.success) {
    throw new AppError(400, result.error.issues[0]?.message ?? "Буруу өгөгдөл илгээгдлээ.")
  }
  return result.data
}

const idSchema = z.uuid({ error: "Буруу ID байна." })
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Огноо буруу байна." })
  .refine((d) => d >= todayKey(0) && d <= todayKey(60), {
    error: "Өнөөдрөөс хойш 60 хоногийн доторх өдөр сонгоно уу.",
  })
const timeSchema = z.enum(TIMES as [string, ...string[]], {
  error: "Боломжит цагаас сонгоно уу.",
})

/** SQL condition: may this user see meeting m at all? */
const ACCESS_SQL = (userParam: string, roleParam: string) => `(
  m.employee_id = ${userParam}
  OR m.requester_id = ${userParam}
  OR (m.recipient_type = 'manager' AND m.recipient_id = ${userParam})
  OR (m.recipient_type = 'hr' AND ${roleParam} = 'hr')
)`

type MeetingRow = {
  id: string
  requester_id: string
  employee_id: string
  initiator: Initiator
  recipient_type: "manager" | "hr"
  recipient_id: string | null
  status: Status
  proposed_time: string | null
}

/** The employee the conversation is about. */
function isEmployeeSide(actor: SessionUser, m: Pick<MeetingRow, "employee_id">) {
  return m.employee_id === actor.id
}

/** The manager (manager channel) or any HR user (HR channel). */
function isStaffSide(
  actor: SessionUser,
  m: Pick<MeetingRow, "employee_id" | "recipient_type" | "recipient_id">,
) {
  if (m.employee_id === actor.id) return false
  if (m.recipient_type === "manager") return m.recipient_id === actor.id
  return actor.role === "hr"
}

/** Side that started the meeting; it accepts proposals. The other side confirms / proposes. */
function isInitiatorSide(actor: SessionUser, m: MeetingRow) {
  return m.initiator === "employee" ? isEmployeeSide(actor, m) : isStaffSide(actor, m)
}

function isInviteeSide(actor: SessionUser, m: MeetingRow) {
  return m.initiator === "employee" ? isStaffSide(actor, m) : isEmployeeSide(actor, m)
}

async function lockMeeting(c: PoolClient, actor: SessionUser, meetingId: string) {
  const { rows } = await c.query(
    `SELECT m.id, m.requester_id, m.employee_id, m.initiator, m.recipient_type, m.recipient_id,
            m.status, m.proposed_time
       FROM meetings m
      WHERE m.id = $1 AND ${ACCESS_SQL("$2", "$3")}
      FOR UPDATE`,
    [meetingId, actor.id, actor.role],
  )
  if (!rows[0]) throw new AppError(404, "Уулзалт олдсонгүй.")
  return rows[0] as MeetingRow
}

async function logActivity(
  c: PoolClient,
  actorId: string,
  entityType: string,
  entityId: string,
  action: string,
) {
  await c.query(
    "INSERT INTO activity_log (actor_id, entity_type, entity_id, action) VALUES ($1, $2, $3, $4)",
    [actorId, entityType, entityId, action],
  )
}

async function addHistory(
  c: PoolClient,
  meetingId: string,
  actorId: string,
  action: string,
  from: Status | null,
  to: Status | null,
  details?: Record<string, unknown>,
) {
  await c.query(
    `INSERT INTO meeting_history (meeting_id, actor_id, action, from_status, to_status, details)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [meetingId, actorId, action, from, to, details ? JSON.stringify(details) : null],
  )
}

/** Notify the other side of the meeting. HR-team meetings without an assignee notify every HR user. */
async function notifyOtherSide(
  c: PoolClient,
  actor: SessionUser,
  m: MeetingRow,
  message: string,
) {
  const targets: string[] = []
  if (!isEmployeeSide(actor, m)) targets.push(m.employee_id)
  else if (m.recipient_id) targets.push(m.recipient_id)
  else {
    const { rows } = await c.query("SELECT id FROM users WHERE role = 'hr' AND id <> $1", [actor.id])
    targets.push(...rows.map((r: { id: string }) => r.id))
  }
  for (const userId of targets) {
    await c.query(
      "INSERT INTO notifications (user_id, meeting_id, message) VALUES ($1, $2, $3)",
      [userId, m.id, message],
    )
  }
}

function formatDue(date: string | null) {
  if (!date) return null
  const [, month, day] = date.split("-").map(Number)
  return `${month} сарын ${day}`
}

// ---------- reads ----------

const MEETING_SELECT = `
  SELECT m.id, m.requester_id, m.employee_id, m.initiator, m.meeting_type, m.purpose, m.agenda,
         m.recipient_type, m.recipient_id, m.topics, m.note,
         to_char(m.meeting_date, 'YYYY-MM-DD') AS date_key,
         m.meeting_time, m.backup_time, m.proposed_time, m.duration_minutes,
         m.mode, m.status, m.created_at,
         e.name AS requester_name, e.initials AS requester_initials,
         rc.name AS recipient_name, rc.initials AS recipient_initials,
         EXISTS (
           SELECT 1 FROM conversation_pulse p
            WHERE p.meeting_id = m.id AND p.respondent_id = $1
         ) AS pulse_submitted,
         COALESCE((
           SELECT json_agg(json_build_object(
                    'id', a.id, 'title', a.title, 'owner_id', a.owner_id,
                    'owner_name', o.name, 'due', to_char(a.due_date, 'YYYY-MM-DD'),
                    'status', a.status) ORDER BY a.created_at)
             FROM action_items a JOIN users o ON o.id = a.owner_id
            WHERE a.meeting_id = m.id
         ), '[]'::json) AS follow_ups
    FROM meetings m
    JOIN users e ON e.id = m.employee_id
    LEFT JOIN users rc ON rc.id = m.recipient_id
   WHERE ${ACCESS_SQL("$1", "$2")}`

type ListRow = MeetingRow & {
  meeting_type: MeetingType
  purpose: string | null
  agenda: string[]
  topics: string[]
  note: string | null
  date_key: string
  meeting_time: string
  backup_time: string | null
  duration_minutes: number
  mode: "in_person" | "teams"
  created_at: Date
  requester_name: string
  requester_initials: string
  recipient_name: string | null
  recipient_initials: string | null
  pulse_submitted: boolean
  follow_ups: {
    id: string
    title: string
    owner_id: string
    owner_name: string
    due: string | null
    status: "open" | "done"
  }[]
}

function toDto(row: ListRow, actor: SessionUser): Meeting {
  const isHr = row.recipient_type === "hr"
  const type: MeetingType = ALL_TYPES.includes(row.meeting_type) ? row.meeting_type : "general"
  return {
    id: row.id,
    isMine: isEmployeeSide(actor, row),
    initiator: row.initiator,
    canRespond: row.status === "pending" && isInviteeSide(actor, row),
    canAccept: row.status === "proposed" && isInitiatorSide(actor, row),
    type,
    typeLabel: GUIDES[type].label,
    purpose: row.purpose ?? undefined,
    agenda: row.agenda ?? [],
    recipientType: row.recipient_type,
    employee: row.requester_name,
    employeeInitials: row.requester_initials,
    employeeId: row.employee_id,
    manager: isHr ? HR_TEAM_NAME : (row.recipient_name ?? "—"),
    managerInitials: isHr ? "HR" : (row.recipient_initials ?? "—"),
    topics: row.topics,
    note: row.note ?? undefined,
    date: row.date_key,
    time: row.meeting_time,
    backupTime: row.backup_time ?? undefined,
    alternateTime: row.status === "proposed" ? (row.proposed_time ?? undefined) : undefined,
    duration: `${row.duration_minutes} минут`,
    mode: MODE_LABEL[row.mode],
    status: row.status,
    createdAt: new Date(row.created_at).getTime(),
    pulseSubmitted: row.pulse_submitted,
    followUps: row.follow_ups.map((f) => ({
      id: f.id,
      task: f.title,
      owner: f.owner_name,
      ownerIsMe: f.owner_id === actor.id,
      due: formatDue(f.due),
      done: f.status === "done",
    })),
  }
}

export async function listMeetings(actor: SessionUser): Promise<Meeting[]> {
  const rows = await query<ListRow>(
    `${MEETING_SELECT} ORDER BY m.meeting_date, m.meeting_time`,
    [actor.id, actor.role],
  )
  return rows.map((row) => toDto(row, actor))
}

export async function getMeeting(actor: SessionUser, meetingId: string): Promise<Meeting> {
  const id = parse(idSchema, meetingId)
  const rows = await query<ListRow>(`${MEETING_SELECT} AND m.id = $3`, [actor.id, actor.role, id])
  if (!rows[0]) throw new AppError(404, "Уулзалт олдсонгүй.")
  return toDto(rows[0], actor)
}

// ---------- create ----------

const createSchema = z
  .object({
    recipient: z.enum(["manager", "hr"], { error: "Уулзах хүнээ сонгоно уу." }),
    topics: z
      .array(z.string().max(60))
      .min(1, { error: "Ярилцах сэдвээс дор хаяж нэгийг сонгоорой." })
      .max(6),
    note: z.string().trim().max(240, { error: "Тайлбар 240 тэмдэгтээс хэтэрсэн байна." }).optional(),
    date: dateSchema,
    time: timeSchema,
    backupTime: z.union([timeSchema, z.literal("")]).optional(),
    mode: z.enum(["Биечлэн", "Microsoft Teams"]),
    requestKey: z.uuid({ error: "Хүсэлтийн түлхүүр буруу байна." }),
  })
  .refine((v) => !v.backupTime || v.backupTime !== v.time, {
    error: "Өөр боломжит цаг үндсэн цагаас ялгаатай байх ёстой.",
  })
  .refine(
    (v) => v.topics.every((t) => (v.recipient === "hr" ? HR_TOPICS : MANAGER_TOPICS).includes(t)),
    { error: "Сэдэв буруу байна." },
  )

export async function createMeeting(actor: SessionUser, input: unknown): Promise<Meeting> {
  const data = parse(createSchema, input)
  if (data.recipient === "manager" && !actor.managerId) {
    throw new AppError(400, "Танд шууд удирдлага бүртгэгдээгүй байна. HR-тэй холбогдоно уу.")
  }
  if (data.recipient === "hr" && actor.role === "hr") {
    throw new AppError(403, "HR ажилтан өөрийн багт хүсэлт илгээх боломжгүй.")
  }

  const meetingId = await tx(async (c) => {
    const inserted = await c.query(
      `INSERT INTO meetings (requester_id, recipient_type, recipient_id, topics, note,
                             meeting_date, meeting_time, backup_time, mode, status, request_key,
                             employee_id, initiator, meeting_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', $10, $1, 'employee', $11)
       ON CONFLICT (request_key) DO NOTHING
       RETURNING id`,
      [
        actor.id,
        data.recipient,
        data.recipient === "manager" ? actor.managerId : null,
        [...new Set(data.topics)],
        data.note || null,
        data.date,
        data.time,
        data.backupTime || null,
        data.mode === "Биечлэн" ? "in_person" : "teams",
        data.requestKey,
        typeFromTopics(data.topics),
      ],
    )
    if (!inserted.rows[0]) {
      // Same request submitted twice (double click / retry): return the original.
      const existing = await c.query(
        "SELECT id FROM meetings WHERE request_key = $1 AND requester_id = $2",
        [data.requestKey, actor.id],
      )
      if (!existing.rows[0]) throw new AppError(409, "Хүсэлтийг давхар илгээх боломжгүй.")
      return existing.rows[0].id as string
    }
    const id = inserted.rows[0].id as string
    const row: MeetingRow = {
      id,
      requester_id: actor.id,
      employee_id: actor.id,
      initiator: "employee",
      recipient_type: data.recipient,
      recipient_id: data.recipient === "manager" ? actor.managerId : null,
      status: "pending",
      proposed_time: null,
    }
    await addHistory(c, id, actor.id, "created", null, "pending")
    await logActivity(c, actor.id, "meeting", id, "create")
    await notifyOtherSide(c, actor, row, `${actor.name} танд уулзалтын хүсэлт илгээлээ.`)
    return id
  })
  return getMeeting(actor, meetingId)
}

// ---------- lifecycle ----------

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("confirm") }),
  z.object({ action: z.literal("propose"), date: dateSchema, time: timeSchema }),
  z.object({ action: z.literal("accept") }),
  z.object({ action: z.literal("cancel") }),
  z.object({ action: z.literal("complete") }),
])

export async function updateMeetingStatus(
  actor: SessionUser,
  meetingId: string,
  input: unknown,
): Promise<Meeting> {
  const id = parse(idSchema, meetingId)
  const data = parse(actionSchema, input)

  await tx(async (c) => {
    const m = await lockMeeting(c, actor, id)
    const invitee = isInviteeSide(actor, m)
    const initiatorSide = isInitiatorSide(actor, m)
    const staff = isStaffSide(actor, m)
    const assignHr = m.recipient_type === "hr" && staff ? actor.id : m.recipient_id
    let next: Status
    let message: string

    switch (data.action) {
      case "confirm":
        if (!invitee) throw new AppError(403, "Энэ уулзалтыг батлах эрх танд байхгүй.")
        if (m.status !== "pending") throw new AppError(409, "Зөвхөн хүлээгдэж буй хүсэлтийг батална.")
        next = "confirmed"
        await c.query(
          "UPDATE meetings SET status = $2, recipient_id = $3, updated_at = now() WHERE id = $1",
          [id, next, assignHr],
        )
        message = `${actor.name} уулзалтын цагийг баталгаажууллаа.`
        break

      case "propose":
        if (!invitee) throw new AppError(403, "Шинэ цаг санал болгох эрх танд байхгүй.")
        if (!["pending", "proposed", "confirmed"].includes(m.status)) {
          throw new AppError(409, "Энэ уулзалтын цагийг өөрчлөх боломжгүй.")
        }
        next = "proposed"
        await c.query(
          `UPDATE meetings SET status = $2, meeting_date = $3, proposed_time = $4,
                  recipient_id = $5, updated_at = now() WHERE id = $1`,
          [id, next, data.date, data.time, assignHr],
        )
        message = `${actor.name} уулзалтад шинэ цаг санал болголоо.`
        break

      case "accept":
        if (!initiatorSide) throw new AppError(403, "Санал болгосон цагийг зөвхөн уулзалт санаачлагч хүлээн авна.")
        if (m.status !== "proposed") throw new AppError(409, "Хүлээн авах шинэ цаг алга.")
        next = "confirmed"
        await c.query(
          `UPDATE meetings SET status = $2, meeting_time = proposed_time, proposed_time = NULL,
                  updated_at = now() WHERE id = $1`,
          [id, next],
        )
        message = `${actor.name} санал болгосон цагийг зөвшөөрлөө.`
        break

      case "cancel":
        if (!invitee && !initiatorSide) throw new AppError(403, "Энэ уулзалтыг цуцлах эрх танд байхгүй.")
        if (!["pending", "proposed", "confirmed"].includes(m.status)) {
          throw new AppError(409, "Энэ уулзалтыг цуцлах боломжгүй.")
        }
        next = "cancelled"
        await c.query("UPDATE meetings SET status = $2, updated_at = now() WHERE id = $1", [id, next])
        message = `${actor.name} уулзалтыг цуцаллаа.`
        break

      case "complete":
        if (!staff) throw new AppError(403, "Уулзалтыг зөвхөн удирдлага эсвэл HR дуусгана.")
        if (m.status !== "confirmed") throw new AppError(409, "Зөвхөн баталгаажсан уулзалтыг дуусгана.")
        next = "completed"
        await c.query("UPDATE meetings SET status = $2, updated_at = now() WHERE id = $1", [id, next])
        message = "Уулзалт дууслаа. Уулзалт хэр үр дүнтэй байсныг 1 минутад үнэлнэ үү."
        break
    }

    await addHistory(c, id, actor.id, data.action, m.status, next,
      data.action === "propose" ? { date: data.date, time: data.time } : undefined)
    await logActivity(c, actor.id, "meeting", id, data.action)
    await notifyOtherSide(c, actor, m, message)
  })

  return getMeeting(actor, id)
}

// ---------- private notes (author only) ----------

async function assertAccess(actor: SessionUser, meetingId: string) {
  const rows = await query(
    `SELECT 1 FROM meetings m WHERE m.id = $1 AND ${ACCESS_SQL("$2", "$3")}`,
    [meetingId, actor.id, actor.role],
  )
  if (!rows[0]) throw new AppError(404, "Уулзалт олдсонгүй.")
}

export async function getPrivateNote(actor: SessionUser, meetingId: string) {
  const id = parse(idSchema, meetingId)
  await assertAccess(actor, id)
  const rows = await query<{ content: string; updated_at: Date }>(
    "SELECT content, updated_at FROM private_notes WHERE meeting_id = $1 AND author_id = $2",
    [id, actor.id],
  )
  return { content: rows[0]?.content ?? "", updatedAt: rows[0]?.updated_at ?? null }
}

const noteSchema = z.object({
  content: z.string().max(5000, { error: "Тэмдэглэл 5000 тэмдэгтээс хэтэрсэн байна." }),
})

export async function savePrivateNote(actor: SessionUser, meetingId: string, input: unknown) {
  const id = parse(idSchema, meetingId)
  const { content } = parse(noteSchema, input)
  await assertAccess(actor, id)
  await tx(async (c) => {
    if (!content.trim()) {
      await c.query("DELETE FROM private_notes WHERE meeting_id = $1 AND author_id = $2", [id, actor.id])
    } else {
      await c.query(
        `INSERT INTO private_notes (meeting_id, author_id, content) VALUES ($1, $2, $3)
         ON CONFLICT (meeting_id, author_id)
         DO UPDATE SET content = EXCLUDED.content, updated_at = now()`,
        [id, actor.id, content],
      )
    }
    await logActivity(c, actor.id, "private_note", id, "save") // content is never logged
  })
  return getPrivateNote(actor, id)
}

// ---------- shared follow-up actions ----------

const followUpSchema = z.object({
  task: z.string().trim().min(2, { error: "Ажлын нэрийг бичнэ үү." }).max(200),
  ownerId: idSchema,
  due: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")]).optional(),
})

export async function createFollowUp(actor: SessionUser, meetingId: string, input: unknown) {
  const id = parse(idSchema, meetingId)
  const data = parse(followUpSchema, input)
  await tx(async (c) => {
    const m = await lockMeeting(c, actor, id)
    const staff = isStaffSide(actor, m)
    if (!staff && !isEmployeeSide(actor, m)) {
      throw new AppError(403, "Зөвхөн оролцогчид ажил нэмнэ.")
    }
    if (!staff && data.ownerId !== actor.id) {
      throw new AppError(403, "Та зөвхөн өөртөө ажил нэмэх боломжтой.")
    }
    if (!["confirmed", "completed"].includes(m.status)) {
      throw new AppError(409, "Баталгаажсан эсвэл дууссан уулзалтад л ажил нэмнэ.")
    }
    if (data.ownerId !== m.employee_id && data.ownerId !== actor.id) {
      throw new AppError(400, "Хариуцагч нь уулзалтын оролцогч байх ёстой.")
    }
    const { rows } = await c.query(
      `INSERT INTO action_items (meeting_id, title, owner_id, created_by, due_date)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [id, data.task, data.ownerId, actor.id, data.due || null],
    )
    await logActivity(c, actor.id, "action_item", rows[0].id, "create")
    if (data.ownerId !== actor.id) {
      await c.query(
        "INSERT INTO notifications (user_id, meeting_id, message) VALUES ($1, $2, $3)",
        [data.ownerId, id, `Танд шинэ ажил оноогдлоо: ${data.task}`],
      )
    }
  })
  return getMeeting(actor, id)
}

const toggleSchema = z.object({ done: z.boolean() })

export async function setFollowUpDone(actor: SessionUser, itemId: string, input: unknown) {
  const id = parse(idSchema, itemId)
  const { done } = parse(toggleSchema, input)
  const meetingId = await tx(async (c) => {
    const { rows } = await c.query(
      `SELECT a.id, a.meeting_id, a.owner_id, a.created_by
         FROM action_items a JOIN meetings m ON m.id = a.meeting_id
        WHERE a.id = $1 AND ${ACCESS_SQL("$2", "$3")}
        FOR UPDATE OF a`,
      [id, actor.id, actor.role],
    )
    const item = rows[0]
    if (!item) throw new AppError(404, "Ажил олдсонгүй.")
    if (item.owner_id !== actor.id && item.created_by !== actor.id) {
      throw new AppError(403, "Зөвхөн хариуцагч эсвэл үүсгэгч төлөвийг өөрчилнө.")
    }
    await c.query(
      `UPDATE action_items SET status = $2,
              completed_at = CASE WHEN $2 = 'done' THEN now() ELSE NULL END
        WHERE id = $1`,
      [id, done ? "done" : "open"],
    )
    await logActivity(c, actor.id, "action_item", id, done ? "complete" : "reopen")
    return item.meeting_id as string
  })
  return getMeeting(actor, meetingId)
}

// ---------- conversation pulse ----------

const pulseSchema = z.object({
  rating: z.number().int().min(1, { error: "1–5 оноогоор үнэлнэ үү." }).max(5),
  nextStep: z.enum(["yes", "partly", "no"], { error: "Дараагийн алхам тодорхой эсэхийг сонгоно уу." }),
  feedback: z.string().trim().max(500).optional(),
})

export async function submitPulse(actor: SessionUser, meetingId: string, input: unknown) {
  const id = parse(idSchema, meetingId)
  const data = parse(pulseSchema, input)
  await tx(async (c) => {
    const m = await lockMeeting(c, actor, id)
    if (!isEmployeeSide(actor, m) && !isStaffSide(actor, m)) {
      throw new AppError(403, "Зөвхөн оролцогчид үнэлгээ өгнө.")
    }
    if (m.status !== "completed") throw new AppError(409, "Уулзалт дууссаны дараа үнэлнэ.")
    try {
      await c.query("SAVEPOINT pulse")
      await c.query(
        `INSERT INTO conversation_pulse (meeting_id, respondent_id, rating, next_step, feedback)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, actor.id, data.rating, data.nextStep, data.feedback || null],
      )
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        await c.query("ROLLBACK TO SAVEPOINT pulse")
        throw new AppError(409, "Та энэ уулзалтад аль хэдийн үнэлгээ өгсөн байна.")
      }
      throw error
    }
    await logActivity(c, actor.id, "pulse", id, "submit")
  })
  return getMeeting(actor, id)
}

// ---------- HR aggregate metrics (no conversation content) ----------

export async function getHrMetrics(actor: SessionUser) {
  if (actor.role !== "hr") throw new AppError(403, "Нэгтгэсэн үзүүлэлтийг зөвхөн HR харна.")
  const [counts] = await query<{
    total: string
    completed: string
    completed_30: string
    manager_total: string
    hr_total: string
  }>(
    `SELECT count(*) AS total,
            count(*) FILTER (WHERE status = 'completed') AS completed,
            count(*) FILTER (WHERE status = 'completed' AND updated_at > now() - interval '30 days') AS completed_30,
            count(*) FILTER (WHERE recipient_type = 'manager') AS manager_total,
            count(*) FILTER (WHERE recipient_type = 'hr') AS hr_total
       FROM meetings`,
  )
  const [pulse] = await query<{ responses: string; avg: string | null; yes: string }>(
    `SELECT count(*) AS responses, avg(rating) AS avg,
            count(*) FILTER (WHERE next_step = 'yes') AS yes
       FROM conversation_pulse`,
  )
  const responses = Number(pulse.responses)
  const hidden = responses < MIN_REPORTING
  return {
    total: Number(counts.total),
    completed: Number(counts.completed),
    completedLast30: Number(counts.completed_30),
    managerMeetings: Number(counts.manager_total),
    hrMeetings: Number(counts.hr_total),
    pulse: {
      responses,
      hidden,
      minReporting: MIN_REPORTING,
      avgRating: hidden || pulse.avg === null ? null : Math.round(Number(pulse.avg) * 10) / 10,
      clearNextStepPct: hidden ? null : Math.round((Number(pulse.yes) / responses) * 100),
    },
  }
}

// ---------- notifications ----------

export async function listNotifications(actor: SessionUser) {
  return query<{ id: string; message: string; meeting_id: string | null; read_at: Date | null; created_at: Date }>(
    `SELECT id, message, meeting_id, read_at, created_at
       FROM notifications WHERE user_id = $1
      ORDER BY created_at DESC LIMIT 20`,
    [actor.id],
  )
}

export async function markNotificationsRead(actor: SessionUser) {
  await query("UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL", [actor.id])
}

// ---------- manager / HR initiated conversations ----------

const inviteSchema = z.object({
  employeeId: idSchema,
  type: z.enum(ALL_TYPES as [MeetingType, ...MeetingType[]], { error: "Уулзалтын төрлөө сонгоно уу." }),
  purpose: z
    .string()
    .trim()
    .min(5, { error: "Уулзалтын зорилгыг товч бичнэ үү." })
    .max(300, { error: "Зорилго 300 тэмдэгтээс хэтэрсэн байна." }),
  agenda: z
    .array(z.string().trim().min(2, { error: "Agenda-ийн зүйл хэт богино байна." }).max(160, { error: "Agenda-ийн зүйл 160 тэмдэгтээс хэтэрсэн байна." }))
    .min(1, { error: "Agenda-д дор хаяж нэг зүйл нэмнэ үү." })
    .max(10, { error: "Agenda 10-аас олон зүйлтэй байж болохгүй." }),
  date: dateSchema,
  time: timeSchema,
  mode: z.enum(["Биечлэн", "Microsoft Teams"]),
  requestKey: z.uuid({ error: "Хүсэлтийн түлхүүр буруу байна." }),
})

/** A manager invites a direct report, or HR invites any non-HR colleague. */
export async function inviteMeeting(actor: SessionUser, input: unknown): Promise<Meeting> {
  if (actor.role === "employee") throw new AppError(403, "Уулзалтыг зөвхөн удирдлага эсвэл HR санаачилна.")
  const data = parse(inviteSchema, input)
  const allowed = actor.role === "hr" ? HR_TYPES : MANAGER_TYPES
  if (!allowed.includes(data.type)) throw new AppError(400, "Энэ төрлийн уулзалтыг санаачлах боломжгүй.")
  if (data.employeeId === actor.id) throw new AppError(400, "Өөртэйгөө уулзалт товлох боломжгүй.")

  const [employee] = await query<{ id: string; manager_id: string | null; role: string; name: string }>(
    "SELECT id, manager_id, role, name FROM users WHERE id = $1",
    [data.employeeId],
  )
  if (!employee) throw new AppError(404, "Ажилтан олдсонгүй.")
  if (actor.role === "manager" && employee.manager_id !== actor.id) {
    throw new AppError(403, "Зөвхөн өөрийн багийн ажилтантай уулзалт товлоно.")
  }
  if (actor.role === "hr" && employee.role === "hr") {
    throw new AppError(400, "HR багийн гишүүнтэй энэ хэсгээс уулзалт товлох боломжгүй.")
  }
  const channel = actor.role === "hr" ? "hr" : "manager"

  const meetingId = await tx(async (c) => {
    const inserted = await c.query(
      `INSERT INTO meetings (requester_id, recipient_type, recipient_id, topics, meeting_date, meeting_time,
                             mode, status, request_key, employee_id, initiator, meeting_type, purpose, agenda)
       VALUES ($1, $2, $1, $3, $4, $5, $6, 'pending', $7, $8, $9, $10, $11, $12)
       ON CONFLICT (request_key) DO NOTHING
       RETURNING id`,
      [
        actor.id,
        channel,
        [GUIDES[data.type].label],
        data.date,
        data.time,
        data.mode === "Биечлэн" ? "in_person" : "teams",
        data.requestKey,
        employee.id,
        actor.role,
        data.type,
        data.purpose,
        [...new Set(data.agenda)],
      ],
    )
    if (!inserted.rows[0]) {
      const existing = await c.query("SELECT id FROM meetings WHERE request_key = $1 AND requester_id = $2", [
        data.requestKey,
        actor.id,
      ])
      if (!existing.rows[0]) throw new AppError(409, "Хүсэлтийг давхар илгээх боломжгүй.")
      return existing.rows[0].id as string
    }
    const id = inserted.rows[0].id as string
    await addHistory(c, id, actor.id, "invited", null, "pending", { type: data.type })
    await logActivity(c, actor.id, "meeting", id, "invite")
    await c.query("INSERT INTO notifications (user_id, meeting_id, message) VALUES ($1, $2, $3)", [
      employee.id,
      id,
      `${actor.name} тантай "${GUIDES[data.type].label}" уулзалт хийхийг санал болголоо.`,
    ])
    return id
  })
  return getMeeting(actor, meetingId)
}

// ---------- people the actor can start a conversation with ----------

export type Person = {
  id: string
  name: string
  initials: string
  role: "employee" | "manager" | "hr"
  department: string | null
  jobTitle: string | null
  managerName: string | null
  lastMeeting: string | null
  daysSinceLast: number | null
  upcoming: number
  openActions: number
}

export async function listPeople(actor: SessionUser): Promise<Person[]> {
  if (actor.role === "employee") throw new AppError(403, "Энэ жагсаалтыг зөвхөн удирдлага, HR харна.")
  // Manager: only meetings on the manager channel with themselves. HR: every meeting (counts only).
  const scope = actor.role === "manager" ? "AND m.recipient_type = 'manager' AND m.recipient_id = $1" : ""
  const filter = actor.role === "manager" ? "u.manager_id = $1" : "u.role <> 'hr' AND u.id <> $1"
  const rows = await query<{
    id: string
    name: string
    initials: string
    role: Person["role"]
    department: string | null
    job_title: string | null
    manager_name: string | null
    last_meeting: string | null
    days_since: number | null
    upcoming: string
    open_actions: string
  }>(
    `SELECT u.id, u.name, u.initials, u.role, u.department, u.job_title, mg.name AS manager_name,
            to_char(max(m.meeting_date) FILTER (WHERE m.status = 'completed'), 'YYYY-MM-DD') AS last_meeting,
            (current_date - max(m.meeting_date) FILTER (WHERE m.status = 'completed'))::int AS days_since,
            count(m.id) FILTER (WHERE m.status IN ('pending', 'proposed', 'confirmed')) AS upcoming,
            (SELECT count(*) FROM action_items a JOIN meetings am ON am.id = a.meeting_id
              WHERE a.owner_id = u.id AND a.status = 'open'
                ${actor.role === "manager" ? "AND am.recipient_type = 'manager' AND am.recipient_id = $1" : ""}) AS open_actions
       FROM users u
       LEFT JOIN users mg ON mg.id = u.manager_id
       LEFT JOIN meetings m ON m.employee_id = u.id ${scope}
      WHERE ${filter}
      GROUP BY u.id, mg.name
      ORDER BY u.name`,
    [actor.id],
  )
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    initials: r.initials,
    role: r.role,
    department: r.department,
    jobTitle: r.job_title,
    managerName: r.manager_name,
    lastMeeting: r.last_meeting,
    daysSinceLast: r.days_since,
    upcoming: Number(r.upcoming),
    openActions: Number(r.open_actions),
  }))
}

// ---------- HR insights: department + individual summaries ----------
// Built only from metadata: meeting types/status, topics, action-item counts and
// pulse aggregates (hidden below MIN_REPORTING). Never private notes or pulse comments.

type DeptRow = {
  department: string
  people: string
  meetings: string
  completed: string
  completed_90: string
  covered_90: string
  actions_open: string
  actions_done: string
  actions_overdue: string
  pulse_n: string
  pulse_avg: string | null
  pulse_yes: string
}

export async function getDepartmentInsights(actor: SessionUser) {
  if (actor.role !== "hr") throw new AppError(403, "Дүгнэлтийг зөвхөн HR харна.")
  const rows = await query<DeptRow>(
    `WITH emp AS (
       SELECT id, COALESCE(NULLIF(department, ''), 'Тодорхойгүй') AS department
         FROM users WHERE role <> 'hr'
     )
     SELECT e.department,
            count(DISTINCT e.id) AS people,
            count(DISTINCT m.id) AS meetings,
            count(DISTINCT m.id) FILTER (WHERE m.status = 'completed') AS completed,
            count(DISTINCT m.id) FILTER (WHERE m.status = 'completed' AND m.meeting_date > current_date - 90) AS completed_90,
            count(DISTINCT m.employee_id) FILTER (WHERE m.status = 'completed' AND m.meeting_date > current_date - 90) AS covered_90,
            (SELECT count(*) FROM action_items a JOIN emp e2 ON e2.id = a.owner_id
              WHERE e2.department = e.department AND a.status = 'open') AS actions_open,
            (SELECT count(*) FROM action_items a JOIN emp e2 ON e2.id = a.owner_id
              WHERE e2.department = e.department AND a.status = 'done') AS actions_done,
            (SELECT count(*) FROM action_items a JOIN emp e2 ON e2.id = a.owner_id
              WHERE e2.department = e.department AND a.status = 'open' AND a.due_date < current_date) AS actions_overdue,
            (SELECT count(*) FROM conversation_pulse p JOIN meetings pm ON pm.id = p.meeting_id
               JOIN emp e3 ON e3.id = pm.employee_id WHERE e3.department = e.department) AS pulse_n,
            (SELECT avg(p.rating) FROM conversation_pulse p JOIN meetings pm ON pm.id = p.meeting_id
               JOIN emp e3 ON e3.id = pm.employee_id WHERE e3.department = e.department) AS pulse_avg,
            (SELECT count(*) FILTER (WHERE p.next_step = 'yes') FROM conversation_pulse p JOIN meetings pm ON pm.id = p.meeting_id
               JOIN emp e3 ON e3.id = pm.employee_id WHERE e3.department = e.department) AS pulse_yes
       FROM emp e
       LEFT JOIN meetings m ON m.employee_id = e.id
      GROUP BY e.department
      ORDER BY e.department`,
  )
  const types = await query<{ department: string; meeting_type: MeetingType; n: string }>(
    `SELECT COALESCE(NULLIF(u.department, ''), 'Тодорхойгүй') AS department, m.meeting_type, count(*) AS n
       FROM meetings m JOIN users u ON u.id = m.employee_id
      WHERE u.role <> 'hr'
      GROUP BY 1, 2`,
  )
  const topics = await query<{ department: string; topic: string; n: string }>(
    `SELECT COALESCE(NULLIF(u.department, ''), 'Тодорхойгүй') AS department, t.topic, count(*) AS n
       FROM meetings m JOIN users u ON u.id = m.employee_id, unnest(m.topics) AS t(topic)
      WHERE u.role <> 'hr' AND m.initiator = 'employee'
      GROUP BY 1, 2 ORDER BY n DESC`,
  )

  const departments = rows.map((r) => {
    const pulseN = Number(r.pulse_n)
    const hidden = pulseN < MIN_REPORTING
    const people = Number(r.people)
    const byType = types
      .filter((t) => t.department === r.department)
      .map((t) => ({ type: t.meeting_type, label: GUIDES[t.meeting_type]?.label ?? t.meeting_type, count: Number(t.n) }))
      .sort((a, b) => b.count - a.count)
    const topTopics = topics
      .filter((t) => t.department === r.department)
      .slice(0, 3)
      .map((t) => t.topic)
    const coverage = people ? Math.round((Number(r.covered_90) / people) * 100) : 0
    const d = {
      department: r.department,
      people,
      meetings: Number(r.meetings),
      completed: Number(r.completed),
      completed90: Number(r.completed_90),
      coverage90: coverage,
      actionsOpen: Number(r.actions_open),
      actionsDone: Number(r.actions_done),
      actionsOverdue: Number(r.actions_overdue),
      pulse: {
        responses: pulseN,
        hidden,
        avgRating: hidden || r.pulse_avg === null ? null : Math.round(Number(r.pulse_avg) * 10) / 10,
        clearNextStepPct: hidden ? null : Math.round((Number(r.pulse_yes) / pulseN) * 100),
      },
      byType,
      topTopics,
    }
    return { ...d, summary: summarizeDepartment(d) }
  })
  return { departments, minReporting: MIN_REPORTING }
}

function summarizeDepartment(d: {
  department: string
  people: number
  completed90: number
  coverage90: number
  actionsOpen: number
  actionsDone: number
  actionsOverdue: number
  pulse: { hidden: boolean; avgRating: number | null }
  byType: { label: string; count: number }[]
  topTopics: string[]
}) {
  const lines: string[] = []
  lines.push(
    `${d.department}: ${d.people} ажилтнаас сүүлийн 90 хоногт ${d.coverage90}% нь дор хаяж нэг 1:1 уулзалт хийсэн (${d.completed90} уулзалт).`,
  )
  if (d.topTopics.length) lines.push(`Ажилтнууд хамгийн их ярихыг хүссэн сэдэв: ${d.topTopics.join(", ")}.`)
  if (d.byType.length) lines.push(`Гол төрөл: ${d.byType.slice(0, 3).map((t) => `${t.label} (${t.count})`).join(", ")}.`)
  const total = d.actionsOpen + d.actionsDone
  if (total) {
    lines.push(
      `Тохиролцсон ${total} ажлаас ${d.actionsDone} нь дууссан${d.actionsOverdue ? `, ${d.actionsOverdue} нь хугацаа хэтэрсэн` : ""}.`,
    )
  }
  if (!d.pulse.hidden && d.pulse.avgRating !== null) lines.push(`Уулзалтын үр өгөөжийн дундаж: ${d.pulse.avgRating}/5.`)
  const recs: string[] = []
  if (d.coverage90 < 70) recs.push("1:1 хамрагдалт бага байна. Удирдлагуудад тогтмол уулзалт товлохыг сануулаарай.")
  if (d.actionsOverdue > 0) recs.push("Хугацаа хэтэрсэн тохиролцоог дараагийн уулзалтаар эргэн харах хэрэгтэй.")
  if (!d.byType.some((t) => t.label === GUIDES.career.label)) recs.push("Карьерын яриа хийгдээгүй байна.")
  if (d.pulse.avgRating !== null && d.pulse.avgRating < 3.5) recs.push("Үр өгөөж доогуур. Удирдлагуудад ярилцлагын хөтчийг ашиглахыг зөвлөөрэй.")
  return { lines, recommendations: recs }
}

export async function getPersonInsight(actor: SessionUser, personId: string) {
  if (actor.role !== "hr") throw new AppError(403, "Хувь хүний дүгнэлтийг зөвхөн HR харна.")
  const id = parse(idSchema, personId)
  const [person] = await query<{
    id: string
    name: string
    initials: string
    department: string | null
    job_title: string | null
    manager_name: string | null
    created_at: Date
  }>(
    `SELECT u.id, u.name, u.initials, u.department, u.job_title, mg.name AS manager_name, u.created_at
       FROM users u LEFT JOIN users mg ON mg.id = u.manager_id
      WHERE u.id = $1 AND u.role <> 'hr'`,
    [id],
  )
  if (!person) throw new AppError(404, "Ажилтан олдсонгүй.")

  const meetings = await query<{
    meeting_type: MeetingType
    status: Status
    recipient_type: "manager" | "hr"
    initiator: Initiator
    date_key: string
    topics: string[]
  }>(
    `SELECT meeting_type, status, recipient_type, initiator, to_char(meeting_date, 'YYYY-MM-DD') AS date_key, topics
       FROM meetings WHERE employee_id = $1 ORDER BY meeting_date DESC`,
    [id],
  )
  const [actions] = await query<{ open: string; done: string; overdue: string }>(
    `SELECT count(*) FILTER (WHERE status = 'open') AS open,
            count(*) FILTER (WHERE status = 'done') AS done,
            count(*) FILTER (WHERE status = 'open' AND due_date < current_date) AS overdue
       FROM action_items WHERE owner_id = $1`,
    [id],
  )

  const completed = meetings.filter((m) => m.status === "completed")
  const today = todayKey(0)
  const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)
  const last = completed[0]?.date_key ?? null
  const daysSinceLast = last ? daysBetween(last, today) : null
  const lastOf = (type: MeetingType) => completed.find((m) => m.meeting_type === type)?.date_key ?? null
  const lastCareer = lastOf("career")
  const lastStay = lastOf("stay_interview")
  const byType = ALL_TYPES.map((t) => ({
    type: t,
    label: GUIDES[t].label,
    count: completed.filter((m) => m.meeting_type === t).length,
  })).filter((t) => t.count > 0)
  const topicCounts = new Map<string, number>()
  for (const m of meetings.filter((x) => x.initiator === "employee")) {
    for (const t of m.topics) topicCounts.set(t, (topicCounts.get(t) ?? 0) + 1)
  }
  const topTopics = [...topicCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([t]) => t)
  const tenureDays = daysBetween(new Date(person.created_at).toISOString().slice(0, 10), today)

  const signals: { level: "ok" | "warn"; text: string }[] = []
  if (daysSinceLast === null) signals.push({ level: "warn", text: "Одоогоор дууссан 1:1 уулзалт алга." })
  else if (daysSinceLast > 45) signals.push({ level: "warn", text: `Сүүлийн 1:1 уулзалтаас хойш ${daysSinceLast} хоног өнгөрсөн.` })
  else signals.push({ level: "ok", text: `Сүүлийн 1:1 уулзалт ${daysSinceLast} хоногийн өмнө болсон.` })
  if (!lastCareer || daysBetween(lastCareer, today) > 180) {
    signals.push({ level: "warn", text: "Сүүлийн 6 сард карьерын яриа хийгээгүй." })
  }
  if (!lastStay && tenureDays > 180) signals.push({ level: "warn", text: "Stay interview хийгдээгүй." })
  if (Number(actions.overdue) > 0) {
    signals.push({ level: "warn", text: `${actions.overdue} тохиролцсон ажлын хугацаа хэтэрсэн.` })
  }
  if (meetings.filter((m) => m.initiator === "employee" && m.recipient_type === "hr").length >= 2) {
    signals.push({ level: "warn", text: "HR-тай олон удаа уулзах хүсэлт гаргасан. Дэмжлэг хэрэгтэй эсэхийг анхаараарай." })
  }

  const suggested: MeetingType[] = []
  if (tenureDays < 100 && !lastOf("onboarding")) suggested.push("onboarding")
  if (!lastCareer || daysBetween(lastCareer, today) > 180) suggested.push("career")
  if (!lastStay && tenureDays > 180) suggested.push("stay_interview")
  if (!suggested.length) suggested.push("wellbeing")

  return {
    person: {
      id: person.id,
      name: person.name,
      initials: person.initials,
      department: person.department,
      jobTitle: person.job_title,
      managerName: person.manager_name,
    },
    totals: {
      meetings: meetings.length,
      completed: completed.length,
      withManager: completed.filter((m) => m.recipient_type === "manager").length,
      withHr: completed.filter((m) => m.recipient_type === "hr").length,
      upcoming: meetings.filter((m) => ["pending", "proposed", "confirmed"].includes(m.status)).length,
    },
    lastMeeting: last,
    daysSinceLast,
    lastCareer,
    lastStay,
    byType,
    topTopics,
    actions: { open: Number(actions.open), done: Number(actions.done), overdue: Number(actions.overdue) },
    signals,
    suggested: suggested.map((t) => ({ type: t, label: GUIDES[t].label })),
  }
}

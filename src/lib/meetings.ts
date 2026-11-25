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
  type Status,
} from "./types"

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
  m.requester_id = ${userParam}
  OR (m.recipient_type = 'manager' AND m.recipient_id = ${userParam})
  OR (m.recipient_type = 'hr' AND ${roleParam} = 'hr')
)`

type MeetingRow = {
  id: string
  requester_id: string
  recipient_type: "manager" | "hr"
  recipient_id: string | null
  status: Status
  proposed_time: string | null
}

function isRequester(actor: SessionUser, m: MeetingRow) {
  return m.requester_id === actor.id
}

function isRecipientSide(actor: SessionUser, m: MeetingRow) {
  if (m.requester_id === actor.id) return false
  if (m.recipient_type === "manager") return m.recipient_id === actor.id
  return actor.role === "hr"
}

async function lockMeeting(c: PoolClient, actor: SessionUser, meetingId: string) {
  const { rows } = await c.query(
    `SELECT m.id, m.requester_id, m.recipient_type, m.recipient_id, m.status, m.proposed_time
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
  if (m.requester_id !== actor.id) targets.push(m.requester_id)
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
  SELECT m.id, m.requester_id, m.recipient_type, m.recipient_id, m.topics, m.note,
         to_char(m.meeting_date, 'YYYY-MM-DD') AS date_key,
         m.meeting_time, m.backup_time, m.proposed_time, m.duration_minutes,
         m.mode, m.status, m.created_at,
         r.name AS requester_name, r.initials AS requester_initials,
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
    JOIN users r ON r.id = m.requester_id
    LEFT JOIN users rc ON rc.id = m.recipient_id
   WHERE ${ACCESS_SQL("$1", "$2")}`

type ListRow = MeetingRow & {
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
  return {
    id: row.id,
    isMine: row.requester_id === actor.id,
    recipientType: row.recipient_type,
    employee: row.requester_name,
    employeeInitials: row.requester_initials,
    employeeId: row.requester_id,
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
                             meeting_date, meeting_time, backup_time, mode, status, request_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', $10)
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
    const recipientSide = isRecipientSide(actor, m)
    const requester = isRequester(actor, m)
    const assignHr = m.recipient_type === "hr" && recipientSide ? actor.id : m.recipient_id
    let next: Status
    let message: string

    switch (data.action) {
      case "confirm":
        if (!recipientSide) throw new AppError(403, "Энэ уулзалтыг батлах эрх танд байхгүй.")
        if (m.status !== "pending") throw new AppError(409, "Зөвхөн хүлээгдэж буй хүсэлтийг батална.")
        next = "confirmed"
        await c.query(
          "UPDATE meetings SET status = $2, recipient_id = $3, updated_at = now() WHERE id = $1",
          [id, next, assignHr],
        )
        message = `${actor.name} уулзалтын цагийг баталгаажууллаа.`
        break

      case "propose":
        if (!recipientSide) throw new AppError(403, "Шинэ цаг санал болгох эрх танд байхгүй.")
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
        if (!requester) throw new AppError(403, "Санал болгосон цагийг зөвхөн хүсэлт илгээгч хүлээн авна.")
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
        if (!requester && !recipientSide) throw new AppError(403, "Энэ уулзалтыг цуцлах эрх танд байхгүй.")
        if (!["pending", "proposed", "confirmed"].includes(m.status)) {
          throw new AppError(409, "Энэ уулзалтыг цуцлах боломжгүй.")
        }
        next = "cancelled"
        await c.query("UPDATE meetings SET status = $2, updated_at = now() WHERE id = $1", [id, next])
        message = `${actor.name} уулзалтыг цуцаллаа.`
        break

      case "complete":
        if (!recipientSide) throw new AppError(403, "Уулзалтыг зөвхөн удирдлага эсвэл HR дуусгана.")
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
    if (!isRecipientSide(actor, m)) {
      throw new AppError(403, "Тохиролцсон ажлыг удирдлага эсвэл HR нэмнэ.")
    }
    if (!["confirmed", "completed"].includes(m.status)) {
      throw new AppError(409, "Баталгаажсан эсвэл дууссан уулзалтад л ажил нэмнэ.")
    }
    if (data.ownerId !== m.requester_id && data.ownerId !== actor.id) {
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
    if (!isRequester(actor, m) && !isRecipientSide(actor, m)) {
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

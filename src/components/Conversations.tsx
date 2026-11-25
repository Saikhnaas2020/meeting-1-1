"use client"

import { useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  CalendarPlus,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock3,
  History,
  Lightbulb,
  ListChecks,
  LoaderCircle,
  Lock,
  MessageCircleQuestion,
  Monitor,
  Plus,
  Search,
  Sparkles,
  UsersRound,
  X,
} from "lucide-react"
import { GUIDES, HR_TYPES, MANAGER_TYPES, type MeetingType } from "@/lib/guides"
import { TIMES, type Meeting, type MeetingMode, type SessionUser } from "@/lib/types"
import { Avatar, api, buildDays, formatDate, newKey } from "./shared"

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

export type StartRequest = { personId?: string; type?: MeetingType }

function usePeople() {
  const [people, setPeople] = useState<Person[] | null>(null)
  const [error, setError] = useState("")
  useEffect(() => {
    api<{ people: Person[] }>("/api/people")
      .then((d) => setPeople(d.people))
      .catch((e: Error) => setError(e.message))
  }, [])
  return { people, error }
}

function lastLabel(p: Person) {
  if (p.daysSinceLast === null) return "1:1 хийгээгүй"
  if (p.daysSinceLast === 0) return "Сүүлийн 1:1: өнөөдөр"
  return `Сүүлийн 1:1: ${p.daysSinceLast} хоногийн өмнө`
}

// ---------- start a conversation (manager / HR) ----------

export function StartConversation({
  role,
  initial,
  onClose,
  onCreated,
}: {
  role: "manager" | "hr"
  initial: StartRequest
  onClose: () => void
  onCreated: (meeting: Meeting) => void
}) {
  const types = role === "hr" ? HR_TYPES : MANAGER_TYPES
  const { people, error: loadError } = usePeople()
  const days = useMemo(buildDays, [])
  const [requestKey] = useState(newKey)
  const [step, setStep] = useState(1)
  const [search, setSearch] = useState("")
  const [personId, setPersonId] = useState(initial.personId ?? "")
  const startType = initial.type && types.includes(initial.type) ? initial.type : types[0]
  const [type, setType] = useState<MeetingType>(startType)
  const [purpose, setPurpose] = useState("")
  const [agenda, setAgenda] = useState<string[]>(GUIDES[startType].agenda)
  const [custom, setCustom] = useState("")
  const [date, setDate] = useState(days[1].value)
  const [time, setTime] = useState("")
  const [mode, setMode] = useState<MeetingMode>("Биечлэн")
  const [error, setError] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  const person = people?.find((p) => p.id === personId)
  const guide = GUIDES[type]
  const filtered = (people ?? []).filter((p) =>
    `${p.name} ${p.department ?? ""} ${p.jobTitle ?? ""}`.toLowerCase().includes(search.trim().toLowerCase()),
  )

  const pickType = (t: MeetingType) => {
    setType(t)
    setAgenda(GUIDES[t].agenda)
  }
  const toggleAgenda = (item: string) =>
    setAgenda((list) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item].slice(0, 10)))
  const addCustom = () => {
    const v = custom.trim()
    if (v.length < 2 || agenda.includes(v)) return
    setAgenda((list) => [...list, v].slice(0, 10))
    setCustom("")
  }

  const next = () => {
    if (step === 1 && !personId) return setError("Уулзах ажилтнаа сонгоно уу.")
    if (step === 2 && purpose.trim().length < 5) return setError("Уулзалтын зорилгыг товч бичнэ үү.")
    if (step === 2 && agenda.length === 0) return setError("Agenda-д дор хаяж нэг зүйл нэмнэ үү.")
    setError("")
    setStep((s) => Math.min(s + 1, 3))
  }
  const submit = async () => {
    if (!time) return setError("Цагаа сонгоно уу.")
    if (submitting) return
    setSubmitting(true)
    setError("")
    try {
      const { meeting } = await api<{ meeting: Meeting }>("/api/invites", "POST", {
        employeeId: personId,
        type,
        purpose: purpose.trim(),
        agenda,
        date,
        time,
        mode,
        requestKey,
      })
      onCreated(meeting)
      setDone(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Алдаа гарлаа.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="overlay wizard-overlay" role="dialog" aria-modal="true" aria-label="Уулзалт санаачлах">
      <div className="wizard">
        {done ? (
          <div className="wizard-body success-body">
            <span className="success-icon">
              <CheckCircle2 size={34} />
            </span>
            <h2>Урилга илгээгдлээ</h2>
            <p>
              {person?.name} баталгаажуулсны дараа уулзалт товлогдоно. Ярилцлагын хөтөч уулзалтын дэлгэрэнгүйд бэлэн
              байна.
            </p>
            <button className="primary-button wide" onClick={onClose}>
              Хаах
            </button>
          </div>
        ) : (
          <>
            <div className="wizard-top">
              <button
                className="icon-button"
                onClick={step === 1 ? onClose : () => setStep(step - 1)}
                aria-label={step === 1 ? "Хаах" : "Буцах"}
              >
                {step === 1 ? <X size={20} /> : <ArrowLeft size={20} />}
              </button>
              <div className="wizard-progress-copy">
                <span className="mini-label">{role === "hr" ? "HR ЯРИЛЦЛАГА" : "1:1 УУЛЗАЛТ"}</span>
                <strong>
                  {step === 1 ? "Хэнтэй, ямар уулзалт" : step === 2 ? "Зорилго ба agenda" : "Өдөр, цаг"}
                </strong>
              </div>
              <span className="step-count">{step}/3</span>
            </div>
            <div className="wizard-body">
              {step === 1 && (
                <div className="start-step">
                  <label className="field-label" htmlFor="person-search">
                    {role === "hr" ? "Ажилтан" : "Багийн гишүүн"}
                  </label>
                  {role === "hr" && (
                    <div className="search-field">
                      <Search size={16} />
                      <input
                        id="person-search"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Нэр, хэлтэс, албан тушаалаар хайх"
                      />
                    </div>
                  )}
                  {loadError ? (
                    <p className="form-error">{loadError}</p>
                  ) : !people ? (
                    <p className="muted-line">
                      <LoaderCircle className="spin" size={16} /> Ачаалж байна…
                    </p>
                  ) : filtered.length === 0 ? (
                    <p className="muted-line">
                      {role === "manager" ? "Танд бүртгэлтэй багийн гишүүн алга." : "Тохирох ажилтан олдсонгүй."}
                    </p>
                  ) : (
                    <div className="person-pick">
                      {filtered.map((p) => (
                        <button
                          key={p.id}
                          className={personId === p.id ? "selected" : ""}
                          onClick={() => setPersonId(p.id)}
                          aria-pressed={personId === p.id}
                        >
                          <Avatar initials={p.initials} size="sm" />
                          <span>
                            <strong>{p.name}</strong>
                            <small>
                              {[p.jobTitle, p.department].filter(Boolean).join(" · ") || "—"} · {lastLabel(p)}
                            </small>
                          </span>
                          {personId === p.id && <Check size={17} />}
                        </button>
                      ))}
                    </div>
                  )}
                  <label className="field-label">Уулзалтын төрөл</label>
                  <div className="type-grid">
                    {types.map((t) => (
                      <button
                        key={t}
                        className={type === t ? "selected" : ""}
                        onClick={() => pickType(t)}
                        aria-pressed={type === t}
                      >
                        <strong>{GUIDES[t].label}</strong>
                        <small>{GUIDES[t].description}</small>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="start-step">
                  <label className="field-label" htmlFor="purpose">
                    Уулзалтын зорилго
                  </label>
                  <textarea
                    id="purpose"
                    value={purpose}
                    maxLength={300}
                    onChange={(e) => setPurpose(e.target.value)}
                    placeholder={`Жишээ: ${guide.description}`}
                  />
                  <label className="field-label">
                    Agenda <small>Ажилтанд урилгатай хамт харагдана</small>
                  </label>
                  <div className="agenda-list">
                    {[...new Set([...guide.agenda, ...agenda])].map((item) => (
                      <button
                        key={item}
                        className={agenda.includes(item) ? "selected" : ""}
                        onClick={() => toggleAgenda(item)}
                        aria-pressed={agenda.includes(item)}
                      >
                        {agenda.includes(item) ? <CheckCircle2 size={17} /> : <Circle size={17} />}
                        {item}
                      </button>
                    ))}
                  </div>
                  <div className="agenda-add">
                    <input
                      value={custom}
                      maxLength={160}
                      onChange={(e) => setCustom(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addCustom()}
                      placeholder="Өөр зүйл нэмэх"
                      aria-label="Agenda-д зүйл нэмэх"
                    />
                    <button className="secondary-button small" onClick={addCustom} disabled={custom.trim().length < 2}>
                      <Plus size={15} /> Нэмэх
                    </button>
                  </div>
                  <p className="recipient-privacy">
                    <Sparkles size={14} /> {guide.label}-д зориулсан {guide.questions.length} асуулт, зөвлөгөө
                    уулзалтын дэлгэрэнгүйд бэлэн байна.
                  </p>
                </div>
              )}

              {step === 3 && (
                <div className="start-step">
                  <label className="field-label">Өдөр</label>
                  <div className="day-picker">
                    {days.map((day) => (
                      <button key={day.value} className={date === day.value ? "selected" : ""} onClick={() => setDate(day.value)}>
                        <span>{day.day}</span>
                        <strong>{day.number}</strong>
                        <small>{day.month}-р сар</small>
                      </button>
                    ))}
                  </div>
                  <label className="field-label">Цаг</label>
                  <div className="time-grid">
                    {TIMES.map((t) => (
                      <button key={t} className={time === t ? "selected" : ""} onClick={() => setTime(t)}>
                        {t}
                      </button>
                    ))}
                  </div>
                  <label className="field-label">Хэлбэр</label>
                  <div className="mode-switch">
                    {(["Биечлэн", "Microsoft Teams"] as const).map((m) => (
                      <button key={m} className={mode === m ? "selected" : ""} onClick={() => setMode(m)}>
                        {m === "Биечлэн" ? <UsersRound size={16} /> : <Monitor size={16} />} {m}
                      </button>
                    ))}
                  </div>
                  <div className="start-summary">
                    <Avatar initials={person?.initials ?? "?"} size="md" />
                    <div>
                      <strong>{person?.name}</strong>
                      <small>
                        {guide.label} · {formatDate(date)}
                        {time ? `, ${time}` : ""}
                      </small>
                    </div>
                  </div>
                </div>
              )}
              {error && <p className="form-error">{error}</p>}
            </div>
            <div className="wizard-footer">
              {step < 3 ? (
                <button className="primary-button wide" onClick={next}>
                  Үргэлжлүүлэх <ArrowRight size={17} />
                </button>
              ) : (
                <button className="primary-button wide" onClick={submit} disabled={submitting}>
                  {submitting ? <LoaderCircle className="spin" size={17} /> : <CalendarPlus size={17} />} Урилга илгээх
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ---------- conversation guide shown inside a meeting ----------

export function GuidePanel({ meeting }: { meeting: Meeting }) {
  const guide = GUIDES[meeting.type] ?? GUIDES.general
  if (meeting.isMine) {
    return (
      <div className="guide-card">
        <div className="guide-head">
          <Lightbulb size={17} />
          <strong>Уулзалтдаа бэлдэх</strong>
          <span className="type-pill">{guide.label}</span>
        </div>
        <ul>
          {guide.employeePrep.map((q) => (
            <li key={q}>{q}</li>
          ))}
        </ul>
        <p className="recipient-privacy">
          <Lock size={13} /> Хариултаа доорх хувийн тэмдэглэлд бичиж болно. Зөвхөн танд харагдана.
        </p>
      </div>
    )
  }
  return (
    <div className="guide-card">
      <div className="guide-head">
        <Sparkles size={17} />
        <strong>Ярилцлагын хөтөч</strong>
        <span className="type-pill">{guide.label}</span>
      </div>
      <details open>
        <summary>
          <MessageCircleQuestion size={16} /> Нээлттэй асуултууд
        </summary>
        <ol>
          {guide.questions.map((q) => (
            <li key={q}>{q}</li>
          ))}
        </ol>
      </details>
      <details>
        <summary>
          <ListChecks size={16} /> {guide.feedback.title}
        </summary>
        <ol>
          {guide.feedback.steps.map((q) => (
            <li key={q}>{q}</li>
          ))}
        </ol>
      </details>
      <details>
        <summary>
          <Lightbulb size={16} /> Сонсох ба coaching зөвлөгөө
        </summary>
        <ul>
          {guide.tips.map((q) => (
            <li key={q}>{q}</li>
          ))}
        </ul>
      </details>
    </div>
  )
}

// ---------- previous conversations between the same two sides ----------

export function previousMeetings(meeting: Meeting, all: Meeting[]) {
  return all
    .filter(
      (m) =>
        m.id !== meeting.id &&
        m.employeeId === meeting.employeeId &&
        m.recipientType === meeting.recipientType &&
        m.status === "completed" &&
        m.date <= meeting.date,
    )
    .sort((a, b) => (a.date < b.date ? 1 : -1))
}

export function HistoryTips({
  meeting,
  meetings,
  onOpen,
}: {
  meeting: Meeting
  meetings: Meeting[]
  onOpen: (m: Meeting) => void
}) {
  const prev = previousMeetings(meeting, meetings)
  if (!prev.length) return null
  const last = prev[0]
  const open = prev.flatMap((m) => m.followUps.filter((f) => !f.done))
  return (
    <div className="guide-card history-card">
      <div className="guide-head">
        <History size={17} />
        <strong>Өмнөх уулзалтаас</strong>
      </div>
      <p>
        Сүүлийн уулзалт: <b>{formatDate(last.date)}</b>. Сэдэв:{" "}
        {last.initiator === "employee" ? last.topics.join(", ") : last.typeLabel}.
        {prev.length > 1 ? ` Нийт ${prev.length} уулзалт болсон.` : ""}
      </p>
      {open.length > 0 && (
        <>
          <small className="mini-label">ДУУСААГҮЙ ТОХИРОЛЦОО</small>
          <ul>
            {open.slice(0, 4).map((f) => (
              <li key={f.id}>
                {f.task} <small>— {f.owner}</small>
              </li>
            ))}
          </ul>
        </>
      )}
      <button className="text-button" onClick={() => onOpen(last)}>
        Өмнөх уулзалтыг нээх <ChevronRight size={15} />
      </button>
    </div>
  )
}

/** Employee home: a tip drawn from their own history. */
export function EmployeeTips({ meetings, onOpen }: { meetings: Meeting[]; onOpen: (m: Meeting) => void }) {
  const completed = meetings.filter((m) => m.status === "completed").sort((a, b) => (a.date < b.date ? 1 : -1))
  const upcoming = meetings.find((m) => ["pending", "proposed", "confirmed"].includes(m.status))
  const tips: { key: string; text: string; meeting?: Meeting }[] = []
  const unrated = completed.find((m) => !m.pulseSubmitted)
  if (unrated) tips.push({ key: "pulse", text: `"${unrated.typeLabel}" уулзалт хэр үр дүнтэй байсныг 1 минутад үнэлээрэй.`, meeting: unrated })
  const overdue = completed.flatMap((m) => m.followUps.filter((f) => f.ownerIsMe && !f.done).map((f) => ({ f, m })))
  if (overdue.length) {
    tips.push({
      key: "tasks",
      text: `Өмнөх уулзалтаас ${overdue.length} тохиролцсон ажил хийгдэхээр хүлээж байна. Дараагийн уулзалтаар явцаа хуваалцаарай.`,
      meeting: overdue[0].m,
    })
  }
  if (upcoming) {
    const prep = (GUIDES[upcoming.type] ?? GUIDES.general).employeePrep[0]
    tips.push({ key: "prep", text: `Дараагийн уулзалтдаа бэлдэх асуулт: "${prep}"`, meeting: upcoming })
  }
  if (completed[0] && !upcoming) {
    tips.push({
      key: "rhythm",
      text: `Сүүлийн уулзалт ${formatDate(completed[0].date)}-нд болсон. Тогтмол ярилцах нь хамгийн их үр дүн өгдөг.`,
    })
  }
  if (!tips.length) return null
  return (
    <section className="next-section">
      <div className="section-heading">
        <div>
          <span className="mini-label">ТАНД ЗОРИУЛСАН</span>
          <h2>Зөвлөмж</h2>
        </div>
      </div>
      <div className="tip-list">
        {tips.map((t) => (
          <button key={t.key} className="tip-row" onClick={() => t.meeting && onOpen(t.meeting)} disabled={!t.meeting}>
            <Lightbulb size={18} />
            <span>{t.text}</span>
            {t.meeting && <ChevronRight size={17} />}
          </button>
        ))}
      </div>
    </section>
  )
}

// ---------- turn confirmed note lines into shared action items ----------

const BULLET = /^\s*(?:[-*•]|\[\s?\]|\d+[.)]|todo:?|хийх:?)\s*/i
const VERBS = /(хийх|бэлтгэх|илгээх|дуусгах|шалгах|уулзах|танилцуулах|бичих|гаргах|зохион)/i

export function extractActions(text: string) {
  const out: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const bullet = BULLET.test(line)
    const cleaned = line.replace(BULLET, "").trim()
    if (cleaned.length < 4 || cleaned.length > 200) continue
    if (bullet || VERBS.test(cleaned)) out.push(cleaned)
  }
  return [...new Set(out)].slice(0, 10)
}

export function ActionExtractor({
  meeting,
  user,
  content,
  onMeeting,
  onNotify,
  onError,
}: {
  meeting: Meeting
  user: SessionUser
  content: string
  onMeeting: (m: Meeting) => void
  onNotify: (m: string) => void
  onError: (e: unknown) => void
}) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<{ text: string; on: boolean }[]>([])
  const [ownerId, setOwnerId] = useState(meeting.isMine ? user.id : meeting.employeeId)
  const [due, setDue] = useState("")
  const [saving, setSaving] = useState(false)
  if (!["confirmed", "completed"].includes(meeting.status)) return null

  const start = () => {
    const found = extractActions(content)
    setItems(found.map((text) => ({ text, on: true })))
    setOpen(true)
  }
  const save = async () => {
    const chosen = items.filter((i) => i.on)
    if (!chosen.length || saving) return
    setSaving(true)
    try {
      let last: Meeting | null = null
      for (const item of chosen) {
        const d = await api<{ meeting: Meeting }>(`/api/meetings/${meeting.id}/follow-ups`, "POST", {
          task: item.text,
          ownerId,
          due,
        })
        last = d.meeting
      }
      if (last) onMeeting(last)
      onNotify(`${chosen.length} тохиролцсон ажил нэмэгдлээ`)
      setOpen(false)
    } catch (e) {
      onError(e)
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <button className="secondary-button small" onClick={start} disabled={!content.trim()}>
        <ListChecks size={15} /> Тэмдэглэлээс ажил гаргах
      </button>
    )
  }
  return (
    <div className="extractor">
      <strong>Тэмдэглэлээс олдсон ажлууд</strong>
      {items.length === 0 ? (
        <p className="muted-line">
          Ажил олдсонгүй. Мөр бүрийг "- " эсвэл "1." гэж эхлүүлж бичвэл илүү сайн танина.
        </p>
      ) : (
        <div className="agenda-list">
          {items.map((item, i) => (
            <button
              key={item.text}
              className={item.on ? "selected" : ""}
              aria-pressed={item.on}
              onClick={() => setItems((list) => list.map((x, j) => (j === i ? { ...x, on: !x.on } : x)))}
            >
              {item.on ? <CheckCircle2 size={17} /> : <Circle size={17} />}
              {item.text}
            </button>
          ))}
        </div>
      )}
      {items.length > 0 && (
        <div className="follow-up-row">
          {meeting.isMine ? (
            <span className="muted-line">Хариуцагч: {user.name} (би)</span>
          ) : (
            <select aria-label="Хариуцагч" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
              <option value={meeting.employeeId}>{meeting.employee}</option>
              <option value={user.id}>{user.name} (би)</option>
            </select>
          )}
          <input aria-label="Дуусах огноо" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </div>
      )}
      <p className="recipient-privacy">
        <Lock size={13} /> Зөвхөн таны сонгосон мөрүүд нөгөө оролцогчид ажил болж харагдана. Тэмдэглэл тань нууц хэвээр.
      </p>
      <div className="modal-actions">
        <button className="secondary-button small" onClick={() => setOpen(false)}>
          Болих
        </button>
        <button className="primary-button small" onClick={save} disabled={saving || !items.some((i) => i.on)}>
          {saving ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />} Батлаад нэмэх
        </button>
      </div>
    </div>
  )
}

// ---------- manager: my team ----------

export function TeamPage({ onStart }: { onStart: (r: StartRequest) => void }) {
  const { people, error } = usePeople()
  return (
    <div className="content page-enter">
      <section className="page-title">
        <span className="mini-label">МИНИЙ БАГ</span>
        <h1>
          Багийн <span className="outline-text">1:1 хэмнэл</span>
        </h1>
        <p>Хэнтэй удаан ярилцаагүйг харж, дараагийн уулзалтаа санаачлаарай.</p>
      </section>
      {error ? (
        <p className="form-error">{error}</p>
      ) : !people ? (
        <p className="muted-line">
          <LoaderCircle className="spin" size={16} /> Ачаалж байна…
        </p>
      ) : people.length === 0 ? (
        <div className="empty-state">
          <span>
            <UsersRound size={22} />
          </span>
          <div>
            <h3>Багийн гишүүн бүртгэгдээгүй</h3>
            <p>HR-аас багийн бүрэлдэхүүнээ бүртгүүлнэ үү.</p>
          </div>
        </div>
      ) : (
        <div className="people-grid">
          {people.map((p) => {
            const stale = p.daysSinceLast === null || p.daysSinceLast > 30
            return (
              <article key={p.id} className="person-card">
                <div className="person-head">
                  <Avatar initials={p.initials} size="md" />
                  <div>
                    <h3>{p.name}</h3>
                    <p>{p.jobTitle ?? "—"}</p>
                  </div>
                </div>
                <div className="person-stats">
                  <span className={stale ? "warn" : ""}>
                    <Clock3 size={14} /> {lastLabel(p)}
                  </span>
                  <span>
                    <CalendarDays size={14} /> Товлогдсон: {p.upcoming}
                  </span>
                  <span>
                    <ListChecks size={14} /> Нээлттэй ажил: {p.openActions}
                  </span>
                </div>
                <div className="person-actions">
                  <button className="primary-button small" onClick={() => onStart({ personId: p.id, type: "general" })}>
                    <CalendarPlus size={15} /> 1:1 товлох
                  </button>
                  <button className="secondary-button small" onClick={() => onStart({ personId: p.id, type: "career" })}>
                    Карьерын яриа
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ---------- HR: department + individual insights ----------

type DeptInsight = {
  department: string
  people: number
  meetings: number
  completed90: number
  coverage90: number
  actionsOpen: number
  actionsDone: number
  actionsOverdue: number
  pulse: { responses: number; hidden: boolean; avgRating: number | null; clearNextStepPct: number | null }
  byType: { type: MeetingType; label: string; count: number }[]
  topTopics: string[]
  summary: { lines: string[]; recommendations: string[] }
}

type PersonInsight = {
  person: { id: string; name: string; initials: string; department: string | null; jobTitle: string | null; managerName: string | null }
  totals: { meetings: number; completed: number; withManager: number; withHr: number; upcoming: number }
  lastMeeting: string | null
  daysSinceLast: number | null
  lastCareer: string | null
  lastStay: string | null
  byType: { type: MeetingType; label: string; count: number }[]
  topTopics: string[]
  actions: { open: number; done: number; overdue: number }
  signals: { level: "ok" | "warn"; text: string }[]
  suggested: { type: MeetingType; label: string }[]
}

export function InsightsPage({ onStart }: { onStart: (r: StartRequest) => void }) {
  const [tab, setTab] = useState<"dept" | "people">("dept")
  return (
    <div className="content page-enter">
      <section className="page-title">
        <span className="mini-label">HR ДҮГНЭЛТ</span>
        <h1>
          Ярилцлагын <span className="outline-text">дүгнэлт</span>
        </h1>
        <p>Хэлтэс болон ажилтан бүрийн 1:1 хэмнэл, тохиролцооны биелэлт, үр өгөөж.</p>
      </section>
      <div className="segmented" role="tablist">
        <button role="tab" aria-selected={tab === "dept"} className={tab === "dept" ? "active" : ""} onClick={() => setTab("dept")}>
          Хэлтсээр
        </button>
        <button role="tab" aria-selected={tab === "people"} className={tab === "people" ? "active" : ""} onClick={() => setTab("people")}>
          Хувь хүнээр
        </button>
      </div>
      {tab === "dept" ? <DepartmentInsights /> : <PeopleInsights onStart={onStart} />}
      <p className="recipient-privacy">
        <Lock size={14} /> Дүгнэлт зөвхөн уулзалтын төрөл, төлөв, сэдэв, тохиролцооны тоонд тулгуурлана. Хувийн тэмдэглэл,
        үнэлгээний сэтгэгдэл ашиглагдахгүй.
      </p>
    </div>
  )
}

function DepartmentInsights() {
  const [data, setData] = useState<{ departments: DeptInsight[]; minReporting: number } | null>(null)
  const [error, setError] = useState("")
  useEffect(() => {
    api<{ insights: { departments: DeptInsight[]; minReporting: number } }>("/api/insights")
      .then((d) => setData(d.insights))
      .catch((e: Error) => setError(e.message))
  }, [])
  if (error) return <p className="form-error">{error}</p>
  if (!data)
    return (
      <p className="muted-line">
        <LoaderCircle className="spin" size={16} /> Ачаалж байна…
      </p>
    )
  return (
    <div className="insight-list">
      {data.departments.map((d) => (
        <article key={d.department} className="insight-card">
          <div className="insight-head">
            <h3>{d.department}</h3>
            <span>{d.people} ажилтан</span>
          </div>
          <div className="insight-metrics">
            <div>
              <span>1:1 хамрагдалт (90 хоног)</span>
              <strong className={d.coverage90 < 70 ? "warn" : ""}>{d.coverage90}%</strong>
            </div>
            <div>
              <span>Дууссан (90 хоног)</span>
              <strong>{d.completed90}</strong>
            </div>
            <div>
              <span>Тохиролцоо</span>
              <strong>
                {d.actionsDone}/{d.actionsDone + d.actionsOpen}
              </strong>
              {d.actionsOverdue > 0 && <small className="warn">{d.actionsOverdue} хэтэрсэн</small>}
            </div>
            <div>
              <span>Үр өгөөж</span>
              <strong>{d.pulse.avgRating ?? "—"}</strong>
              <small>{d.pulse.hidden ? `${data.minReporting}+ хариулт хэрэгтэй` : `${d.pulse.responses} хариулт`}</small>
            </div>
          </div>
          <div className="insight-summary">
            {d.summary.lines.map((l) => (
              <p key={l}>{l}</p>
            ))}
          </div>
          {d.summary.recommendations.length > 0 && (
            <ul className="signal-list">
              {d.summary.recommendations.map((r) => (
                <li key={r} className="warn">
                  <AlertTriangle size={15} /> {r}
                </li>
              ))}
            </ul>
          )}
        </article>
      ))}
    </div>
  )
}

function PeopleInsights({ onStart }: { onStart: (r: StartRequest) => void }) {
  const { people, error } = usePeople()
  const [search, setSearch] = useState("")
  const [selected, setSelected] = useState<string | null>(null)
  const [insight, setInsight] = useState<PersonInsight | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState("")

  useEffect(() => {
    if (!selected) return
    let alive = true
    setLoading(true)
    setLoadError("")
    api<{ insight: PersonInsight }>(`/api/insights/${selected}`)
      .then((d) => alive && setInsight(d.insight))
      .catch((e: Error) => alive && setLoadError(e.message))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [selected])

  if (error) return <p className="form-error">{error}</p>
  if (!people)
    return (
      <p className="muted-line">
        <LoaderCircle className="spin" size={16} /> Ачаалж байна…
      </p>
    )
  const list = people.filter((p) =>
    `${p.name} ${p.department ?? ""}`.toLowerCase().includes(search.trim().toLowerCase()),
  )
  return (
    <div className="people-insights">
      <div className="people-column">
        <div className="search-field">
          <Search size={16} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Ажилтан хайх" aria-label="Ажилтан хайх" />
        </div>
        <div className="person-pick">
          {list.map((p) => (
            <button key={p.id} className={selected === p.id ? "selected" : ""} onClick={() => setSelected(p.id)}>
              <Avatar initials={p.initials} size="sm" />
              <span>
                <strong>{p.name}</strong>
                <small>
                  {p.department ?? "—"} · {lastLabel(p)}
                </small>
              </span>
              <ChevronRight size={16} />
            </button>
          ))}
        </div>
      </div>
      <div className="insight-card person-insight">
        {!selected ? (
          <p className="muted-line">Дүгнэлт харах ажилтнаа сонгоно уу.</p>
        ) : loading || !insight ? (
          loadError ? (
            <p className="form-error">{loadError}</p>
          ) : (
            <p className="muted-line">
              <LoaderCircle className="spin" size={16} /> Ачаалж байна…
            </p>
          )
        ) : (
          <>
            <div className="person-head">
              <Avatar initials={insight.person.initials} size="lg" />
              <div>
                <h3>{insight.person.name}</h3>
                <p>
                  {[insight.person.jobTitle, insight.person.department].filter(Boolean).join(" · ")}
                  {insight.person.managerName ? ` · Удирдлага: ${insight.person.managerName}` : ""}
                </p>
              </div>
            </div>
            <div className="insight-metrics">
              <div>
                <span>Дууссан уулзалт</span>
                <strong>{insight.totals.completed}</strong>
                <small>
                  Удирдлагатай {insight.totals.withManager} · HR {insight.totals.withHr}
                </small>
              </div>
              <div>
                <span>Сүүлийн 1:1</span>
                <strong>{insight.daysSinceLast === null ? "—" : `${insight.daysSinceLast} хон`}</strong>
                <small>{insight.lastMeeting ? formatDate(insight.lastMeeting) : "Байхгүй"}</small>
              </div>
              <div>
                <span>Тохиролцоо</span>
                <strong>
                  {insight.actions.done}/{insight.actions.done + insight.actions.open}
                </strong>
                {insight.actions.overdue > 0 && <small className="warn">{insight.actions.overdue} хэтэрсэн</small>}
              </div>
            </div>
            <ul className="signal-list">
              {insight.signals.map((s) => (
                <li key={s.text} className={s.level}>
                  {s.level === "warn" ? <AlertTriangle size={15} /> : <CheckCircle2 size={15} />} {s.text}
                </li>
              ))}
            </ul>
            {insight.byType.length > 0 && (
              <div className="chip-row">
                {insight.byType.map((t) => (
                  <span key={t.type} className="type-pill">
                    {t.label} · {t.count}
                  </span>
                ))}
              </div>
            )}
            {insight.topTopics.length > 0 && (
              <p className="muted-line">Өөрөө санаачилсан сэдэв: {insight.topTopics.join(", ")}</p>
            )}
            <div className="suggest-box">
              <strong>Санал болгох дараагийн яриа</strong>
              <div className="person-actions">
                {insight.suggested.map((s) => (
                  <button key={s.type} className="secondary-button small" onClick={() => onStart({ personId: insight.person.id, type: s.type })}>
                    <CalendarPlus size={15} /> {s.label}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

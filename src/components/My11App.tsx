"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  BriefcaseBusiness,
  CalendarPlus,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleUserRound,
  Clock3,
  Coffee,
  HeartHandshake,
  Home,
  Lightbulb,
  LoaderCircle,
  Lock,
  LogOut,
  MessageCircleHeart,
  MessageSquareText,
  Monitor,
  MoreHorizontal,
  ShieldCheck,
  Sparkles,
  UsersRound,
  Video,
  X,
} from "lucide-react"
import {
  HR_TEAM_NAME,
  TIMES,
  type Meeting,
  type MeetingMode,
  type NextStep,
  type SessionUser,
  type Status,
} from "@/lib/types"
import { Avatar, api, buildDays, formatDate, newKey, parts, shownTime } from "./shared"
import {
  ActionExtractor,
  EmployeeTips,
  GuidePanel,
  HistoryTips,
  InsightsPage,
  StartConversation,
  TeamPage,
  type StartRequest,
} from "./Conversations"

type Page = "home" | "meetings" | "team" | "insights"
type ToastState = { message: string; kind: "ok" | "error" } | null

const TOPICS = [
  { label: "Ажлын гүйцэтгэл", icon: BriefcaseBusiness },
  { label: "Карьер, хөгжил", icon: Sparkles },
  { label: "Ажлын ачаалал", icon: Coffee },
  { label: "Хамтын ажиллагаа", icon: UsersRound },
  { label: "Санал, санаачилга", icon: Lightbulb },
  { label: "Бусад", icon: MoreHorizontal },
]

const HR_TOPICS = [
  { label: "Ажлын орчин", icon: BriefcaseBusiness },
  { label: "Ажил, амьдралын тэнцвэр", icon: HeartHandshake },
  { label: "Карьер, хөгжил", icon: Sparkles },
  { label: "Халамж, хангамж", icon: Coffee },
  { label: "Санал, хүсэлт", icon: Lightbulb },
  { label: "Бусад", icon: MoreHorizontal },
]

const STATUS: Record<Status, string> = {
  pending: "Хүлээгдэж байна",
  proposed: "Цаг санал болгосон",
  confirmed: "Баталгаажсан",
  completed: "Дууссан",
  cancelled: "Цуцлагдсан",
}

const ROLE_LABEL = { employee: "Ажилтан", manager: "Удирдлага", hr: "Хүний нөөц" }
const ACTIVE: Status[] = ["pending", "proposed", "confirmed"]

// ---------- small components ----------

function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={`status status-${status}`}>
      <span className="status-dot" />
      {STATUS[status]}
    </span>
  )
}

function Toast({ toast, onDone }: { toast: NonNullable<ToastState>; onDone: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onDone, toast.kind === "error" ? 5000 : 3200)
    return () => window.clearTimeout(timer)
  }, [toast, onDone])
  return (
    <div className={`toast ${toast.kind === "error" ? "toast-error" : ""}`} role={toast.kind === "error" ? "alert" : "status"}>
      <span className="toast-icon">
        {toast.kind === "error" ? <X size={15} strokeWidth={3} /> : <Check size={15} strokeWidth={3} />}
      </span>
      {toast.message}
    </div>
  )
}

// ---------- app ----------

export default function My11App({
  user,
  managerName,
  initialMeetings,
}: {
  user: SessionUser
  managerName: string | null
  initialMeetings: Meeting[]
}) {
  const role = user.role
  const [page, setPage] = useState<Page>("home")
  const [wizardOpen, setWizardOpen] = useState(false)
  const [targetChooserOpen, setTargetChooserOpen] = useState(false)
  const [requestTarget, setRequestTarget] = useState<"manager" | "hr">("manager")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [rescheduleMeeting, setRescheduleMeeting] = useState<Meeting | null>(null)
  const [toast, setToast] = useState<ToastState>(null)
  const [meetings, setMeetings] = useState<Meeting[]>(initialMeetings)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [startRequest, setStartRequest] = useState<StartRequest | null>(null)

  const notify = useCallback((message: string) => setToast({ message, kind: "ok" }), [])
  const fail = useCallback(
    (error: unknown) =>
      setToast({ message: error instanceof Error ? error.message : "Алдаа гарлаа.", kind: "error" }),
    [],
  )
  const clearToast = useCallback(() => setToast(null), [])

  const upsert = useCallback((meeting: Meeting) => {
    setMeetings((current) =>
      current.some((m) => m.id === meeting.id)
        ? current.map((m) => (m.id === meeting.id ? meeting : m))
        : [meeting, ...current],
    )
  }, [])

  const selectedMeeting = meetings.find((m) => m.id === selectedId) ?? null

  /** Runs a status change on the server; success toast only after the server confirms. */
  const changeStatus = useCallback(
    async (id: string, body: Record<string, string>, success: string) => {
      setBusyId(id)
      try {
        const { meeting } = await api<{ meeting: Meeting }>(`/api/meetings/${id}`, "PATCH", body)
        upsert(meeting)
        notify(success)
        return true
      } catch (error) {
        fail(error)
        return false
      } finally {
        setBusyId(null)
      }
    },
    [upsert, notify, fail],
  )

  const firstName = user.name.split(". ").pop() ?? user.name

  return (
    <div className="app-shell">
      <Header user={user} page={page} onPage={setPage} />
      <main id="main-content" className="main">
        {role === "employee" ? (
          page === "home" ? (
            <EmployeeHome
              firstName={firstName}
              meetings={meetings.filter((m) => m.isMine)}
              busyId={busyId}
              onRequest={() => setTargetChooserOpen(true)}
              onOpen={(m) => setSelectedId(m.id)}
              onViewAll={() => setPage("meetings")}
              onConfirm={(id) => changeStatus(id, { action: "confirm" }, "Уулзалтын цаг баталгаажлаа")}
              onReschedule={(meeting) => setRescheduleMeeting(meeting)}
            />
          ) : (
            <MeetingsPage meetings={meetings.filter((m) => m.isMine)} onOpen={(m) => setSelectedId(m.id)} />
          )
        ) : page === "team" && role === "manager" ? (
          <TeamPage onStart={setStartRequest} />
        ) : page === "insights" && role === "hr" ? (
          <InsightsPage onStart={setStartRequest} />
        ) : (
          <ManagerHome
            firstName={firstName}
            meetings={meetings.filter((m) => !m.isMine)}
            view={role === "hr" ? "hr" : "manager"}
            busyId={busyId}
            onOpen={(m) => setSelectedId(m.id)}
            onConfirm={(id) => changeStatus(id, { action: "confirm" }, "Уулзалтын цаг баталгаажлаа")}
            onReschedule={(meeting) => setRescheduleMeeting(meeting)}
            onStart={() => setStartRequest({})}
          />
        )}
      </main>
      <MobileNav role={role} page={page} onPage={setPage} />
      {startRequest && role !== "employee" && (
        <StartConversation
          role={role}
          initial={startRequest}
          onClose={() => setStartRequest(null)}
          onCreated={(meeting) => {
            upsert(meeting)
            notify("Урилга илгээгдлээ")
          }}
        />
      )}
      {targetChooserOpen && (
        <RecipientChooser
          hasManager={Boolean(managerName)}
          onClose={() => setTargetChooserOpen(false)}
          onSelect={(target) => {
            setRequestTarget(target)
            setTargetChooserOpen(false)
            setWizardOpen(true)
          }}
        />
      )}
      {wizardOpen && (
        <RequestWizard
          recipient={requestTarget}
          managerName={managerName ?? "Шууд удирдлага"}
          onClose={() => setWizardOpen(false)}
          onCreated={(meeting) => {
            upsert(meeting)
            notify("Уулзалтын хүсэлт амжилттай илгээгдлээ")
          }}
        />
      )}
      {selectedMeeting && (
        <MeetingDetails
          meeting={selectedMeeting}
          meetings={meetings}
          user={user}
          busy={busyId === selectedMeeting.id}
          onClose={() => setSelectedId(null)}
          onOpenOther={(m) => setSelectedId(m.id)}
          onReschedule={() => setRescheduleMeeting(selectedMeeting)}
          onStatus={async (body, success) => {
            const ok = await changeStatus(selectedMeeting.id, body, success)
            if (ok && (body.action === "accept" || body.action === "cancel")) setSelectedId(null)
          }}
          onMeeting={upsert}
          onNotify={notify}
          onError={fail}
        />
      )}
      {rescheduleMeeting && (
        <RescheduleModal
          meeting={rescheduleMeeting}
          busy={busyId === rescheduleMeeting.id}
          onClose={() => setRescheduleMeeting(null)}
          onSubmit={async (date, time) => {
            const ok = await changeStatus(
              rescheduleMeeting.id,
              { action: "propose", date, time },
              "Шинэ цаг санал болголоо",
            )
            if (ok) setRescheduleMeeting(null)
          }}
        />
      )}
      {toast && <Toast toast={toast} onDone={clearToast} />}
    </div>
  )
}

function Header({
  user,
  page,
  onPage,
}: {
  user: SessionUser
  page: Page
  onPage: (page: Page) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const role = user.role
  const logout = async () => {
    setLeaving(true)
    try {
      await fetch("/api/auth/logout", { method: "POST" })
    } finally {
      window.location.reload()
    }
  }
  return (
    <header className="header">
      <a
        className="brand"
        href="#"
        onClick={(e) => {
          e.preventDefault()
          onPage("home")
        }}
      >
        <span className="brand-mark">
          <MessageCircleHeart size={20} strokeWidth={2.3} />
        </span>
        <span>My 1:1 Meeting</span>
      </a>
      {role === "employee" && (
        <nav className="desktop-nav" aria-label="Үндсэн цэс">
          <button className={page === "home" ? "active" : ""} onClick={() => onPage("home")}>
            Нүүр
          </button>
          <button className={page === "meetings" ? "active" : ""} onClick={() => onPage("meetings")}>
            Миний уулзалтууд
          </button>
        </nav>
      )}
      {role !== "employee" && (
        <nav className="desktop-nav" aria-label="Үндсэн цэс">
          <button className={page === "home" ? "active" : ""} onClick={() => onPage("home")}>
            Нүүр
          </button>
          {role === "manager" ? (
            <button className={page === "team" ? "active" : ""} onClick={() => onPage("team")}>
              Миний баг
            </button>
          ) : (
            <button className={page === "insights" ? "active" : ""} onClick={() => onPage("insights")}>
              Дүгнэлт
            </button>
          )}
        </nav>
      )}
      <div className="header-actions">
        <div className="role-switcher">
          <button className="role-trigger" onClick={() => setMenuOpen(!menuOpen)} aria-expanded={menuOpen}>
            <span className="role-indicator" />
            <span>{ROLE_LABEL[role]}</span>
            <ChevronDown size={14} />
          </button>
          {menuOpen && (
            <div className="role-menu">
              <p>Нэвтэрсэн хэрэглэгч</p>
              <div className="role-menu-user">
                <strong>{user.name}</strong>
                <small>{user.email}</small>
              </div>
              <button onClick={logout} disabled={leaving}>
                {leaving ? <LoaderCircle className="spin" size={17} /> : <LogOut size={17} />} Гарах
              </button>
            </div>
          )}
        </div>
        <Avatar initials={user.initials} size="sm" green={role !== "employee"} />
      </div>
    </header>
  )
}

function MobileNav({ role, page, onPage }: { role: SessionUser["role"]; page: Page; onPage: (page: Page) => void }) {
  const second: { page: Page; label: string; icon: React.ReactNode } =
    role === "employee"
      ? { page: "meetings", label: "Уулзалтууд", icon: <CalendarDays size={21} /> }
      : role === "manager"
        ? { page: "team", label: "Миний баг", icon: <UsersRound size={21} /> }
        : { page: "insights", label: "Дүгнэлт", icon: <BarChart3 size={21} /> }
  return (
    <nav className="mobile-nav" aria-label="Үндсэн цэс">
      <button className={page === "home" ? "active" : ""} onClick={() => onPage("home")}>
        <Home size={21} /> <span>Нүүр</span>
      </button>
      <button className={page === second.page ? "active" : ""} onClick={() => onPage(second.page)}>
        {second.icon} <span>{second.label}</span>
      </button>
    </nav>
  )
}

function EmployeeHome({
  firstName,
  meetings,
  busyId,
  onRequest,
  onOpen,
  onViewAll,
  onConfirm,
  onReschedule,
}: {
  firstName: string
  meetings: Meeting[]
  busyId: string | null
  onRequest: () => void
  onOpen: (meeting: Meeting) => void
  onViewAll: () => void
  onConfirm: (id: string) => void
  onReschedule: (meeting: Meeting) => void
}) {
  const invites = meetings.filter((meeting) => meeting.canRespond)
  const upcoming = meetings.find((meeting) => ACTIVE.includes(meeting.status) && !meeting.canRespond)
  const openTasks = meetings.flatMap((m) => m.followUps.filter((f) => f.ownerIsMe && !f.done).map((f) => ({ ...f, meeting: m })))
  return (
    <div className="content home-content page-enter">
      <section className="welcome">
        <p className="eyebrow">
          Сайн уу, {firstName} <span>👋</span>
        </p>
        <h1>
          Өнөөдөр юуны тухай
          <br className="desktop-break" /> <span className="outline-text">ярилцмаар байна?</span>
        </h1>
      </section>

      <section className="hero-card">
        <div className="hero-copy">
          <span className="hero-icon">
            <HeartHandshake size={24} />
          </span>
          <h2>Ярилцах зүйл байна уу?</h2>
          <p>Санал бодол, хүсэл зорилгоо хуваалцах цаг гаргая.</p>
          <button className="primary-button" onClick={onRequest}>
            <span>+</span> Уулзалт хүсэх
          </button>
        </div>
        <div className="hero-visual" aria-hidden="true">
          <div className="conversation-bubble bubble-one">
            <span />
          </div>
          <div className="conversation-bubble bubble-two">
            <HeartHandshake size={34} />
          </div>
          <div className="conversation-bubble bubble-three">
            <span />
          </div>
        </div>
      </section>

      {invites.length > 0 && (
        <section className="next-section">
          <div className="section-heading">
            <div>
              <span className="mini-label">ТАНД ИРСЭН</span>
              <h2>
                Уулзалтын урилга <em>{invites.length}</em>
              </h2>
            </div>
          </div>
          <div className="request-grid">
            {invites.map((meeting) => (
              <ManagerRequestCard
                key={meeting.id}
                meeting={meeting}
                busy={busyId === meeting.id}
                onOpen={() => onOpen(meeting)}
                onConfirm={() => onConfirm(meeting.id)}
                onReschedule={() => onReschedule(meeting)}
              />
            ))}
          </div>
        </section>
      )}

      <section className="next-section">
        <div className="section-heading">
          <div>
            <span className="mini-label">ТАНЫ ХУВААРЬ</span>
            <h2>Дараагийн уулзалт</h2>
          </div>
          <button className="text-button" onClick={onViewAll}>
            Бүгдийг харах <ArrowRight size={15} />
          </button>
        </div>
        {upcoming ? (
          <MeetingCard meeting={upcoming} onOpen={() => onOpen(upcoming)} featured />
        ) : (
          <div className="empty-state">
            <span>
              <Coffee size={22} />
            </span>
            <div>
              <h3>Одоогоор уулзалт алга</h3>
              <p>Ярилцах зүйл гарвал хүсэлт илгээхэд үргэлж нээлттэй.</p>
            </div>
          </div>
        )}
      </section>

      <EmployeeTips meetings={meetings} onOpen={onOpen} />

      {openTasks.length > 0 && (
        <section className="next-section">
          <div className="section-heading">
            <div>
              <span className="mini-label">ХАМТЫН ТОХИРОЛЦОО</span>
              <h2>Миний хийх ажлууд</h2>
            </div>
          </div>
          <div className="task-list">
            {openTasks.map((task) => (
              <button key={task.id} className="task-row" onClick={() => onOpen(task.meeting)}>
                <Circle size={18} />
                <span>
                  {task.task}
                  {task.due && <small>Дуусах: {task.due}</small>}
                </span>
                <ChevronRight size={17} />
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function MeetingCard({
  meeting,
  onOpen,
  featured = false,
}: {
  meeting: Meeting
  onOpen: () => void
  featured?: boolean
}) {
  const other = meeting.isMine
    ? { name: meeting.manager, initials: meeting.managerInitials }
    : { name: meeting.employee, initials: meeting.employeeInitials }
  return (
    <button className={`meeting-card ${featured ? "featured" : ""}`} onClick={onOpen}>
      <div className="meeting-date-tile">
        <strong>{parts(meeting.date).day}</strong>
        <span>{parts(meeting.date).month}-р сар</span>
      </div>
      <div className="meeting-main">
        <StatusBadge status={meeting.status} />
        <h3>{meeting.initiator === "employee" ? meeting.topics.join(", ") : meeting.typeLabel}</h3>
        <div className="meeting-meta">
          <span>
            <Clock3 size={15} /> {formatDate(meeting.date)}, {shownTime(meeting)}
          </span>
          <span>
            <Avatar initials={other.initials} size="sm" /> {other.name}
          </span>
        </div>
      </div>
      <span className="card-arrow">
        <ChevronRight size={18} />
      </span>
    </button>
  )
}

function MeetingsPage({ meetings, onOpen }: { meetings: Meeting[]; onOpen: (meeting: Meeting) => void }) {
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming")
  const visible = meetings.filter((meeting) =>
    tab === "upcoming" ? ACTIVE.includes(meeting.status) : ["completed", "cancelled"].includes(meeting.status),
  )
  return (
    <div className="content narrow-content page-enter">
      <section className="page-title">
        <span className="mini-label">ТАНЫ ХУВААРЬ</span>
        <h1>Миний уулзалтууд</h1>
        <p>Өмнөх болон товлосон уулзалтуудаа нэг дороос хараарай.</p>
      </section>
      <div className="tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === "upcoming"}
          className={tab === "upcoming" ? "active" : ""}
          onClick={() => setTab("upcoming")}
        >
          Удахгүй <span>{meetings.filter((m) => ACTIVE.includes(m.status)).length}</span>
        </button>
        <button
          role="tab"
          aria-selected={tab === "past"}
          className={tab === "past" ? "active" : ""}
          onClick={() => setTab("past")}
        >
          Өмнөх
        </button>
      </div>
      <div className="meeting-list">
        {visible.length ? (
          visible.map((meeting) => <MeetingCard key={meeting.id} meeting={meeting} onOpen={() => onOpen(meeting)} />)
        ) : (
          <div className="empty-state centered">
            <span>
              <CalendarDays size={23} />
            </span>
            <div>
              <h3>Энд одоогоор уулзалт алга</h3>
              <p>Шинэ уулзалт нэмэгдэхэд энд харагдана.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

type Metrics = {
  total: number
  completed: number
  completedLast30: number
  managerMeetings: number
  hrMeetings: number
  pulse: {
    responses: number
    hidden: boolean
    minReporting: number
    avgRating: number | null
    clearNextStepPct: number | null
  }
}

function HrMetrics() {
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [error, setError] = useState("")
  useEffect(() => {
    api<{ metrics: Metrics }>("/api/metrics")
      .then((d) => setMetrics(d.metrics))
      .catch((e: Error) => setError(e.message))
  }, [])
  return (
    <section className="manager-section">
      <div className="section-heading">
        <div>
          <span className="mini-label">НЭГТГЭСЭН ҮЗҮҮЛЭЛТ</span>
          <h2>Байгууллагын 1:1 соёл</h2>
        </div>
      </div>
      {error ? (
        <p className="form-error">{error}</p>
      ) : !metrics ? (
        <p className="muted-line">
          <LoaderCircle className="spin" size={16} /> Ачаалж байна…
        </p>
      ) : (
        <>
          <div className="metric-grid">
            <div className="metric">
              <span>Нийт уулзалт</span>
              <strong>{metrics.total}</strong>
              <small>
                Удирдлагатай {metrics.managerMeetings} · HR-тэй {metrics.hrMeetings}
              </small>
            </div>
            <div className="metric">
              <span>Дууссан (30 хоног)</span>
              <strong>{metrics.completedLast30}</strong>
              <small>Нийт дууссан {metrics.completed}</small>
            </div>
            <div className="metric">
              <span>Үр өгөөж (1–5)</span>
              <strong>{metrics.pulse.avgRating ?? "—"}</strong>
              <small>{metrics.pulse.responses} хариулт</small>
            </div>
            <div className="metric">
              <span>Дараагийн алхам тодорхой</span>
              <strong>{metrics.pulse.clearNextStepPct === null ? "—" : `${metrics.pulse.clearNextStepPct}%`}</strong>
              <small>Conversation Pulse</small>
            </div>
          </div>
          <p className="recipient-privacy">
            <Lock size={14} />
            {metrics.pulse.hidden
              ? `Нууцлалын үүднээс ${metrics.pulse.minReporting}-аас доош хариулттай үед дүнг харуулахгүй.`
              : "Зөвхөн нэгтгэсэн тоо харагдана. Хувийн тэмдэглэл, ярианы агуулга HR-т харагдахгүй."}
          </p>
        </>
      )}
    </section>
  )
}

function ManagerHome({
  firstName,
  meetings,
  view,
  busyId,
  onOpen,
  onConfirm,
  onReschedule,
  onStart,
}: {
  firstName: string
  meetings: Meeting[]
  view: "manager" | "hr"
  busyId: string | null
  onOpen: (meeting: Meeting) => void
  onConfirm: (id: string) => void
  onReschedule: (meeting: Meeting) => void
  onStart: () => void
}) {
  const isHr = view === "hr"
  const requests = meetings.filter((meeting) => ["pending", "proposed"].includes(meeting.status))
  const upcoming = meetings.filter((meeting) => meeting.status === "confirmed")
  const openFollowUps = meetings.flatMap((m) => m.followUps.filter((f) => !f.done).map((f) => ({ ...f, meeting: m })))
  return (
    <div className="content manager-content page-enter">
      <section className="welcome manager-welcome">
        <p className="eyebrow">
          Сайн уу, {firstName} <span>👋</span>
        </p>
        <h1>
          {isHr ? "HR-тэй ярилцах" : "Тантай ярилцах"}
          <br className="desktop-break" /> <span className="outline-text">хүсэлтүүд</span>
        </h1>
        <p>
          {isHr
            ? "Ажилтны итгэлтэйгээр хуваалцсан хүсэлтийг нууцлалтайгаар хүлээн аваарай."
            : "Багаараа тайван ярилцах цагийг хамтдаа гаргая."}
        </p>
        <div>
          <button className="primary-button" onClick={onStart}>
            <CalendarPlus size={17} /> {isHr ? "Ярилцлага санаачлах" : "1:1 уулзалт товлох"}
          </button>
        </div>
      </section>
      <section className="manager-section">
        <div className="section-heading">
          <div>
            <span className="mini-label">АНХААРАЛ ШААРДАХ</span>
            <h2>
              Хүсэлт ба урилга <em>{requests.filter((m) => m.canRespond).length}</em>
            </h2>
          </div>
        </div>
        <div className="request-grid">
          {requests.length ? (
            requests.map((meeting) => (
              <ManagerRequestCard
                key={meeting.id}
                meeting={meeting}
                busy={busyId === meeting.id}
                onOpen={() => onOpen(meeting)}
                onConfirm={() => onConfirm(meeting.id)}
                onReschedule={() => onReschedule(meeting)}
              />
            ))
          ) : (
            <div className="empty-state">
              <span>
                <CheckCircle2 size={22} />
              </span>
              <div>
                <h3>Бүх хүсэлтийг шийдлээ</h3>
                <p>Шинэ хүсэлт ирэхэд энд харагдана.</p>
              </div>
            </div>
          )}
        </div>
      </section>
      <section className="manager-section upcoming-manager">
        <div className="section-heading">
          <div>
            <span className="mini-label">ТОВЛОГДСОН</span>
            <h2>Удахгүй болох уулзалтууд</h2>
          </div>
        </div>
        <div className="meeting-list compact">
          {upcoming.length ? (
            upcoming.map((meeting) => <MeetingCard key={meeting.id} meeting={meeting} onOpen={() => onOpen(meeting)} />)
          ) : (
            <p className="muted-line">Баталгаажсан уулзалт одоогоор алга.</p>
          )}
        </div>
      </section>
      {openFollowUps.length > 0 && (
        <section className="manager-section">
          <div className="section-heading">
            <div>
              <span className="mini-label">FOLLOW-UP</span>
              <h2>Хийгдэж буй тохиролцоо</h2>
            </div>
          </div>
          <div className="task-list">
            {openFollowUps.map((task) => (
              <button key={task.id} className="task-row" onClick={() => onOpen(task.meeting)}>
                <Circle size={18} />
                <span>
                  {task.task}
                  <small>
                    {task.owner}
                    {task.due ? ` · Дуусах: ${task.due}` : ""}
                  </small>
                </span>
                <ChevronRight size={17} />
              </button>
            ))}
          </div>
        </section>
      )}
      {isHr && <HrMetrics />}
    </div>
  )
}

function ManagerRequestCard({
  meeting,
  busy,
  onOpen,
  onConfirm,
  onReschedule,
}: {
  meeting: Meeting
  busy: boolean
  onOpen: () => void
  onConfirm: () => void
  onReschedule: () => void
}) {
  const waiting = !meeting.canRespond
  const other = meeting.isMine
    ? { name: meeting.manager, initials: meeting.managerInitials }
    : { name: meeting.employee, initials: meeting.employeeInitials }
  const note = meeting.initiator === "employee" ? meeting.note : meeting.purpose
  return (
    <article className="request-card">
      <button className="request-main" onClick={onOpen}>
        <div className="request-person">
          <Avatar initials={other.initials} size="md" green={meeting.isMine} />
          <div>
            <h3>{other.name}</h3>
            <p>
              {meeting.initiator === "employee" ? meeting.topics.join(", ") : meeting.typeLabel}
              {meeting.initiator !== "employee" && !meeting.isMine ? " · таны урилга" : ""}
            </p>
          </div>
          <ChevronRight size={17} />
        </div>
        <div className="request-time">
          <CalendarDays size={16} />
          <span>{formatDate(meeting.date)}</span>
          <i /> <Clock3 size={16} />
          <span>{shownTime(meeting)}</span>
        </div>
        {note && <p className="request-note">“{note}”</p>}
      </button>
      <div className="request-actions">
        {waiting ? (
          <p className="waiting-note">
            <Clock3 size={15} /> {meeting.isMine ? "Хариуг хүлээж байна" : "Ажилтны хариуг хүлээж байна"}
          </p>
        ) : (
          <>
            <button className="primary-button small" onClick={onConfirm} disabled={busy}>
              {busy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />} Баталгаажуулах
            </button>
            <button className="secondary-button small" onClick={onReschedule} disabled={busy}>
              Өөр цаг санал болгох
            </button>
          </>
        )}
      </div>
    </article>
  )
}

function RecipientChooser({
  hasManager,
  onClose,
  onSelect,
}: {
  hasManager: boolean
  onClose: () => void
  onSelect: (target: "manager" | "hr") => void
}) {
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Уулзах хүнээ сонгох">
      <div className="recipient-modal page-enter">
        <div className="modal-header">
          <div>
            <span className="mini-label">ШИНЭ УУЛЗАЛТ</span>
            <h2>Хэнтэй уулзах хүсэлтэй байгаа вэ?</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Хаах">
            <X size={20} />
          </button>
        </div>
        <div className="recipient-options">
          <button onClick={() => onSelect("manager")} disabled={!hasManager}>
            <span className="recipient-option-icon manager-option">
              <UsersRound size={23} />
            </span>
            <span className="recipient-option-copy">
              <strong>Шууд удирдлагатайгаа уулзах</strong>
              <small>
                {hasManager
                  ? "Ажлын гүйцэтгэл, хөгжил, хамтын ажиллагааны талаар ярилцах"
                  : "Танд шууд удирдлага бүртгэгдээгүй байна"}
              </small>
            </span>
            <ChevronRight size={19} />
          </button>
          <button onClick={() => onSelect("hr")}>
            <span className="recipient-option-icon hr-option">
              <ShieldCheck size={23} />
            </span>
            <span className="recipient-option-copy">
              <strong>HR-тайгаа уулзах</strong>
              <small>Ажлын орчин, халамж болон хувийн хүсэлтээ нууцлалтай хуваалцах</small>
            </span>
            <ChevronRight size={19} />
          </button>
        </div>
        <p className="recipient-privacy">
          <ShieldCheck size={14} />
          Таны сонголт болон тайлбар зөвхөн уулзалтад оролцогчдод харагдана.
        </p>
      </div>
    </div>
  )
}

function RequestWizard({
  recipient,
  managerName,
  onClose,
  onCreated,
}: {
  recipient: "manager" | "hr"
  managerName: string
  onClose: () => void
  onCreated: (meeting: Meeting) => void
}) {
  const isHr = recipient === "hr"
  const topicOptions = isHr ? HR_TOPICS : TOPICS
  const recipientName = isHr ? HR_TEAM_NAME : managerName
  const days = useMemo(buildDays, [])
  const [requestKey] = useState(newKey)
  const [step, setStep] = useState(1)
  const [topics, setTopics] = useState<string[]>([])
  const [noteOpen, setNoteOpen] = useState(false)
  const [note, setNote] = useState("")
  const [date, setDate] = useState(days[1].value)
  const [time, setTime] = useState("")
  const [backupTime, setBackupTime] = useState("")
  const [mode, setMode] = useState<MeetingMode>("Биечлэн")
  const [error, setError] = useState("")
  const [success, setSuccess] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const next = () => {
    if (step === 1 && topics.length === 0) {
      setError("Ярилцах сэдвээс дор хаяж нэгийг сонгоорой.")
      return
    }
    if (step === 2 && !time) {
      setError("Өөрт тохирох цагаа сонгоорой.")
      return
    }
    setError("")
    setStep((value) => Math.min(value + 1, 3))
  }
  const submit = async () => {
    if (submitting) return
    setSubmitting(true)
    setError("")
    try {
      const { meeting } = await api<{ meeting: Meeting }>("/api/meetings", "POST", {
        recipient,
        topics,
        note: note.trim() || undefined,
        date,
        time,
        backupTime,
        mode,
        requestKey,
      })
      onCreated(meeting)
      setSuccess(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Алдаа гарлаа.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="overlay wizard-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={isHr ? "HR-тэй уулзах хүсэлт" : "Уулзалт хүсэх"}
    >
      <div className="wizard">
        {!success ? (
          <>
            <div className="wizard-top">
              <button
                className="icon-button"
                onClick={step === 1 ? onClose : () => setStep(step - 1)}
                aria-label={step === 1 ? "Хаах" : "Буцах"}
              >
                {step === 1 ? <X size={20} /> : <ArrowLeft size={20} />}
              </button>
              <div className="progress" aria-label={`Алхам ${step}, нийт 3`}>
                {[1, 2, 3].map((item) => (
                  <span key={item} className={item <= step ? "active" : ""} />
                ))}
              </div>
              <span className="step-count">{step} / 3</span>
            </div>
            <div className="wizard-body">
              {step === 1 && (
                <div className="step page-enter">
                  <StepHeading
                    icon={<MessageSquareText size={20} />}
                    title="Юуны талаар ярилцах вэ?"
                    subtitle={isHr ? "HR багтай ярилцах сэдвээ сонгоорой." : "Ярилцах сэдвээ сонгоорой."}
                  />
                  {isHr && (
                    <div className="hr-privacy-banner">
                      <ShieldCheck size={18} />
                      <p>
                        <strong>Таны яриа нууцлалтай</strong>
                        Дэлгэрэнгүй мэдээлэл бичих албагүй. Зөвхөн уулзалтад оролцогчид таны тайлбарыг харна.
                      </p>
                    </div>
                  )}
                  <div className="topic-grid">
                    {topicOptions.map(({ label, icon: Icon }) => {
                      const selected = topics.includes(label)
                      return (
                        <button
                          key={label}
                          aria-pressed={selected}
                          className={`topic-card ${selected ? "selected" : ""}`}
                          onClick={() => {
                            setTopics((current) =>
                              selected ? current.filter((item) => item !== label) : [...current, label],
                            )
                            setError("")
                          }}
                        >
                          <span>
                            <Icon size={20} />
                          </span>
                          {label}
                          {selected && <Check className="topic-check" size={15} />}
                        </button>
                      )
                    })}
                  </div>
                  <div className="optional-field">
                    <button onClick={() => setNoteOpen(!noteOpen)} aria-expanded={noteOpen}>
                      <span>Нэмж хэлэх зүйл байна уу?</span>
                      <small>Заавал биш</small>
                      <ChevronDown size={17} className={noteOpen ? "rotate" : ""} />
                    </button>
                    {noteOpen && (
                      <div className="note-wrap">
                        <textarea
                          id="request-note"
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          maxLength={240}
                          placeholder="Ярилцахыг хүссэн зүйлээ энд бичээрэй..."
                        />
                        <span>{note.length}/240</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {step === 2 && (
                <div className="step page-enter">
                  <StepHeading
                    icon={<CalendarDays size={20} />}
                    title="Хэзээ уулзахад тохиромжтой вэ?"
                    subtitle="Өөрт тохиромжтой өдөр, цагаа сонгоорой."
                  />
                  <div className="manager-strip">
                    <Avatar initials={isHr ? "HR" : managerName.slice(0, 1)} size="md" green />
                    <div>
                      <h3>{recipientName}</h3>
                      <p>{isHr ? "HR зөвлөх" : "Шууд удирдлага"}</p>
                    </div>
                    <span>
                      <Check size={14} /> Автоматаар сонгогдсон
                    </span>
                  </div>
                  <label className="field-label">Өдөр сонгох</label>
                  <div className="day-picker">
                    {days.map((day) => (
                      <button key={day.value} className={date === day.value ? "selected" : ""} onClick={() => setDate(day.value)}>
                        <span>{day.day}</span>
                        <strong>{day.number}</strong>
                        <small>{day.month}-р сар</small>
                      </button>
                    ))}
                  </div>
                  <div className="field-row">
                    <label className="field-label">Боломжит цаг</label>
                    <span className="duration">
                      <Clock3 size={14} /> 30 минут
                    </span>
                  </div>
                  <div className="time-grid">
                    {TIMES.map((item) => (
                      <button
                        key={item}
                        className={time === item ? "selected" : ""}
                        onClick={() => {
                          setTime(item)
                          if (backupTime === item) setBackupTime("")
                          setError("")
                        }}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                  <div className="schedule-options">
                    <label htmlFor="backup-time">
                      <span>
                        Өөр боломжит цаг <small>Заавал биш</small>
                      </span>
                      <select id="backup-time" value={backupTime} onChange={(e) => setBackupTime(e.target.value)}>
                        <option value="">Сонгоогүй</option>
                        {TIMES.filter((item) => item !== time).map((item) => (
                          <option key={item}>{item}</option>
                        ))}
                      </select>
                    </label>
                    <div>
                      <span className="option-label">Уулзалтын хэлбэр</span>
                      <div className="mode-switch">
                        <button className={mode === "Биечлэн" ? "selected" : ""} onClick={() => setMode("Биечлэн")}>
                          <UsersRound size={16} /> Биечлэн
                        </button>
                        <button
                          className={mode === "Microsoft Teams" ? "selected" : ""}
                          onClick={() => setMode("Microsoft Teams")}
                        >
                          <Video size={16} /> Teams
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {step === 3 && (
                <div className="step page-enter">
                  <StepHeading
                    icon={<Sparkles size={20} />}
                    title="Бүх зүйл бэлэн! ✨"
                    subtitle="Хүсэлтээ нэг шалгаад илгээгээрэй."
                  />
                  <div className="summary-card">
                    <SummaryRow icon={<CircleUserRound />} label="Уулзах хүн" value={recipientName} />
                    <SummaryRow icon={<MessageSquareText />} label="Ярилцах сэдэв" value={topics.join(", ")} />
                    <SummaryRow
                      icon={<CalendarDays />}
                      label="Өдөр, цаг"
                      value={`${formatDate(date)}, ${time}${backupTime ? ` (эсвэл ${backupTime})` : ""}`}
                    />
                    <SummaryRow icon={<Clock3 />} label="Үргэлжлэх хугацаа" value="30 минут" />
                    <SummaryRow
                      icon={mode === "Биечлэн" ? <UsersRound /> : <Monitor />}
                      label="Уулзалтын хэлбэр"
                      value={mode}
                      last
                    />
                  </div>
                  {note && (
                    <div className="privacy-note">
                      <MessageCircleHeart size={17} />
                      <p>
                        <strong>Таны нэмсэн тайлбар</strong>
                        {note}
                      </p>
                    </div>
                  )}
                </div>
              )}
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
            </div>
            <div className="wizard-footer">
              {step === 3 && (
                <button className="secondary-button" onClick={() => setStep(2)} disabled={submitting}>
                  Буцах
                </button>
              )}
              <button className="primary-button wide" onClick={step === 3 ? submit : next} disabled={submitting}>
                {submitting ? (
                  <>
                    <LoaderCircle className="spin" size={18} /> Илгээж байна...
                  </>
                ) : step === 3 ? (
                  <>
                    Хүсэлт илгээх <Check size={18} />
                  </>
                ) : (
                  <>
                    Үргэлжлүүлэх <ArrowRight size={18} />
                  </>
                )}
              </button>
            </div>
          </>
        ) : (
          <div className="success-state page-enter">
            <div className="success-check">
              <span>
                <Check size={34} strokeWidth={2.5} />
              </span>
            </div>
            <span className="mini-label">АМЖИЛТТАЙ</span>
            <h2>Хүсэлт илгээгдлээ!</h2>
            <p>
              {isHr ? "HR баг" : "Удирдлага тань"} уулзалтын цагийг
              <br /> баталгаажуулах болно.
            </p>
            <button className="primary-button" onClick={onClose}>
              Нүүр рүү буцах <ArrowRight size={17} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function StepHeading({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="step-heading">
      <span>{icon}</span>
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
    </div>
  )
}

function SummaryRow({
  icon,
  label,
  value,
  last = false,
}: {
  icon: React.ReactNode
  label: string
  value: string
  last?: boolean
}) {
  return (
    <div className={`summary-row ${last ? "last" : ""}`}>
      <span className="summary-icon">{icon}</span>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
      </div>
    </div>
  )
}

// ---------- meeting details ----------

function PrivateNote({
  meeting,
  user,
  onMeeting,
  onNotify,
  onError,
}: {
  meeting: Meeting
  user: SessionUser
  onMeeting: (m: Meeting) => void
  onNotify: (m: string) => void
  onError: (e: unknown) => void
}) {
  const meetingId = meeting.id
  const [content, setContent] = useState("")
  const [saved, setSaved] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    let alive = true
    api<{ note: { content: string } }>(`/api/meetings/${meetingId}/notes`)
      .then((d) => {
        if (!alive) return
        setContent(d.note.content)
        setSaved(d.note.content)
      })
      .catch(onError)
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [meetingId, onError])
  const save = async () => {
    setSaving(true)
    try {
      const d = await api<{ note: { content: string } }>(`/api/meetings/${meetingId}/notes`, "PUT", { content })
      setSaved(d.note.content)
      onNotify("Хувийн тэмдэглэл хадгалагдлаа")
    } catch (e) {
      onError(e)
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="private-note">
      <div className="private-note-head">
        <Lock size={16} />
        <strong>Миний хувийн тэмдэглэл</strong>
      </div>
      <p>Зөвхөн танд харагдана. Бусад оролцогч, HR хэзээ ч харахгүй.</p>
      <textarea
        id={`private-note-${meetingId}`}
        value={content}
        disabled={loading}
        maxLength={5000}
        onChange={(e) => setContent(e.target.value)}
        placeholder={loading ? "Ачаалж байна…" : "Уулзалтад бэлдэх санаа, өөртөө сануулах зүйлээ бичээрэй..."}
      />
      <button className="secondary-button small" onClick={save} disabled={loading || saving || content === saved}>
        {saving ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}
        {content === saved && !loading ? "Хадгалсан" : "Хадгалах"}
      </button>
      {!loading && (
        <ActionExtractor
          meeting={meeting}
          user={user}
          content={saved}
          onMeeting={onMeeting}
          onNotify={onNotify}
          onError={onError}
        />
      )}
    </div>
  )
}

function FollowUpForm({
  meeting,
  user,
  onMeeting,
  onNotify,
  onError,
}: {
  meeting: Meeting
  user: SessionUser
  onMeeting: (m: Meeting) => void
  onNotify: (m: string) => void
  onError: (e: unknown) => void
}) {
  const [task, setTask] = useState("")
  const [ownerId, setOwnerId] = useState(meeting.isMine ? user.id : meeting.employeeId)
  const [due, setDue] = useState("")
  const [saving, setSaving] = useState(false)
  const submit = async () => {
    if (saving) return
    setSaving(true)
    try {
      const d = await api<{ meeting: Meeting }>(`/api/meetings/${meeting.id}/follow-ups`, "POST", { task, ownerId, due })
      onMeeting(d.meeting)
      setTask("")
      setDue("")
      onNotify("Тохиролцсон ажил нэмэгдлээ")
    } catch (e) {
      onError(e)
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="follow-up-form">
      <label htmlFor="fu-task" className="field-label">
        Шинэ тохиролцоо нэмэх
      </label>
      <input id="fu-task" value={task} maxLength={200} onChange={(e) => setTask(e.target.value)} placeholder="Жишээ: Сургалтын төлөвлөгөө гаргах" />
      <div className="follow-up-row">
        <select id="fu-owner" aria-label="Хариуцагч" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
          {!meeting.isMine && <option value={meeting.employeeId}>{meeting.employee}</option>}
          <option value={user.id}>{user.name} (би)</option>
        </select>
        <input id="fu-due" aria-label="Дуусах огноо" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
      </div>
      <button className="secondary-button small" onClick={submit} disabled={saving || task.trim().length < 2}>
        {saving ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />} Хадгалах
      </button>
    </div>
  )
}

function PulseForm({
  meeting,
  onMeeting,
  onNotify,
  onError,
}: {
  meeting: Meeting
  onMeeting: (m: Meeting) => void
  onNotify: (m: string) => void
  onError: (e: unknown) => void
}) {
  const [rating, setRating] = useState(0)
  const [nextStep, setNextStep] = useState<NextStep | "">("")
  const [feedback, setFeedback] = useState("")
  const [saving, setSaving] = useState(false)
  const submit = async () => {
    if (saving) return
    setSaving(true)
    try {
      const d = await api<{ meeting: Meeting }>(`/api/meetings/${meeting.id}/pulse`, "POST", {
        rating,
        nextStep,
        feedback: feedback.trim() || undefined,
      })
      onMeeting(d.meeting)
      onNotify("Үнэлгээ өгсөнд баярлалаа")
    } catch (e) {
      onError(e)
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="pulse-card">
      <span className="mini-label">CONVERSATION PULSE</span>
      <h3>Энэ яриа хэр хэрэгтэй байсан бэ?</h3>
      <div className="pulse-scale" role="radiogroup" aria-label="1-5 оноо">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} role="radio" aria-checked={rating === n} className={rating === n ? "selected" : ""} onClick={() => setRating(n)}>
            {n}
          </button>
        ))}
      </div>
      <h3>Дараагийн алхам тодорхой болсон уу?</h3>
      <div className="mode-switch">
        {(
          [
            ["yes", "Тийм"],
            ["partly", "Хэсэгчлэн"],
            ["no", "Үгүй"],
          ] as const
        ).map(([value, label]) => (
          <button key={value} className={nextStep === value ? "selected" : ""} onClick={() => setNextStep(value)}>
            {label}
          </button>
        ))}
      </div>
      <textarea
        id={`pulse-${meeting.id}`}
        value={feedback}
        maxLength={500}
        onChange={(e) => setFeedback(e.target.value)}
        placeholder="Нэмэлт сэтгэгдэл (заавал биш)"
      />
      <button className="primary-button wide" onClick={submit} disabled={saving || !rating || !nextStep}>
        {saving ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />} Үнэлгээ илгээх
      </button>
      <p className="recipient-privacy">
        <Lock size={13} /> HR зөвхөн нэгтгэсэн дүнг харна.
      </p>
    </div>
  )
}

function MeetingDetails({
  meeting,
  meetings,
  user,
  busy,
  onClose,
  onOpenOther,
  onReschedule,
  onStatus,
  onMeeting,
  onNotify,
  onError,
}: {
  meeting: Meeting
  meetings: Meeting[]
  user: SessionUser
  busy: boolean
  onClose: () => void
  onOpenOther: (m: Meeting) => void
  onReschedule: () => void
  onStatus: (body: Record<string, string>, success: string) => void
  onMeeting: (m: Meeting) => void
  onNotify: (m: string) => void
  onError: (e: unknown) => void
}) {
  const mine = meeting.isMine
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const toggleFollowUp = async (id: string, done: boolean) => {
    setTogglingId(id)
    try {
      const d = await api<{ meeting: Meeting }>(`/api/follow-ups/${id}`, "PATCH", { done })
      onMeeting(d.meeting)
      onNotify(done ? "Ажлыг дууссан гэж тэмдэглэлээ" : "Ажлыг дахин нээлээ")
    } catch (e) {
      onError(e)
    } finally {
      setTogglingId(null)
    }
  }

  return (
    <div className="overlay detail-overlay" role="dialog" aria-modal="true" aria-label="Уулзалтын дэлгэрэнгүй">
      <div className="detail-panel page-enter">
        <div className="modal-header">
          <div>
            <span className="mini-label">УУЛЗАЛТЫН МЭДЭЭЛЭЛ</span>
            <h2>Дэлгэрэнгүй</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Хаах">
            <X size={20} />
          </button>
        </div>
        <div className="detail-status">
          <StatusBadge status={meeting.status} />
        </div>
        <div className="detail-person">
          <Avatar initials={mine ? meeting.managerInitials : meeting.employeeInitials} size="lg" green={mine} />
          <div>
            <small>{mine ? "УУЛЗАХ ХҮН" : "АЖИЛТАН"}</small>
            <h3>{mine ? meeting.manager : meeting.employee}</h3>
            <p>
              {mine
                ? meeting.recipientType === "hr"
                  ? "HR зөвлөх"
                  : "Шууд удирдлага"
                : meeting.initiator === "employee"
                  ? "Танд хүсэлт илгээсэн ажилтан"
                  : "Таны урьсан ажилтан"}
            </p>
          </div>
        </div>
        <div className="detail-info">
          <SummaryRow icon={<Sparkles />} label="Уулзалтын төрөл" value={meeting.typeLabel} />
          {meeting.initiator === "employee" && (
            <SummaryRow icon={<MessageSquareText />} label="Ярилцах сэдэв" value={meeting.topics.join(", ")} />
          )}
          <SummaryRow
            icon={<CalendarDays />}
            label="Өдөр, цаг"
            value={`${formatDate(meeting.date)}, ${shownTime(meeting)}${
              meeting.backupTime && meeting.status === "pending" ? ` (эсвэл ${meeting.backupTime})` : ""
            }`}
          />
          <SummaryRow icon={<Clock3 />} label="Үргэлжлэх хугацаа" value={meeting.duration} />
          <SummaryRow
            icon={meeting.mode === "Биечлэн" ? <UsersRound /> : <Monitor />}
            label="Уулзалтын хэлбэр"
            value={meeting.mode}
            last
          />
        </div>
        {meeting.note && (
          <div className="detail-note">
            <small>ЗӨВХӨН ОРОЛЦОГЧДОД ХАРАГДАНА</small>
            <p>“{meeting.note}”</p>
          </div>
        )}
        {(meeting.purpose || meeting.agenda.length > 0) && (
          <div className="detail-note agenda-note">
            <small>ЗОРИЛГО БА AGENDA</small>
            {meeting.purpose && <p>“{meeting.purpose}”</p>}
            {meeting.agenda.length > 0 && (
              <ol>
                {meeting.agenda.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ol>
            )}
          </div>
        )}

        {meeting.canRespond && (
          <div className="detail-actions">
            <button
              className="primary-button"
              disabled={busy}
              onClick={() => onStatus({ action: "confirm" }, "Уулзалтын цаг баталгаажлаа")}
            >
              {busy ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />} Баталгаажуулах
            </button>
            <button className="secondary-button" disabled={busy} onClick={onReschedule}>
              Өөр цаг санал болгох
            </button>
          </div>
        )}

        {ACTIVE.includes(meeting.status) && <GuidePanel meeting={meeting} />}
        <HistoryTips meeting={meeting} meetings={meetings} onOpen={onOpenOther} />

        {(meeting.followUps.length > 0 || ["confirmed", "completed"].includes(meeting.status)) && (
          <div className="follow-up">
            <span className="mini-label">ХАМТЫН ТОХИРОЛЦОО</span>
            <h3>Тохиролцсон ажлууд</h3>
            {meeting.followUps.map((f) => (
              <div key={f.id} className={f.done ? "done" : ""}>
                <button
                  className="follow-up-toggle"
                  aria-label={f.done ? "Дахин нээх" : "Дууссан гэж тэмдэглэх"}
                  disabled={togglingId === f.id || !(f.ownerIsMe || !mine)}
                  onClick={() => toggleFollowUp(f.id, !f.done)}
                >
                  {togglingId === f.id ? <LoaderCircle className="spin" size={19} /> : f.done ? <CheckCircle2 size={19} /> : <Circle size={19} />}
                </button>
                <p>
                  {f.task}
                  <small>
                    {f.owner}
                    {f.due ? ` · Дуусах: ${f.due}` : ""}
                  </small>
                </p>
              </div>
            ))}
            {["confirmed", "completed"].includes(meeting.status) && (
              <FollowUpForm meeting={meeting} user={user} onMeeting={onMeeting} onNotify={onNotify} onError={onError} />
            )}
          </div>
        )}

        {meeting.status === "completed" && !meeting.pulseSubmitted && (
          <PulseForm meeting={meeting} onMeeting={onMeeting} onNotify={onNotify} onError={onError} />
        )}
        {meeting.status === "completed" && meeting.pulseSubmitted && (
          <p className="recipient-privacy">
            <CheckCircle2 size={14} /> Та энэ уулзалтад үнэлгээ өгсөн байна.
          </p>
        )}

        <PrivateNote meeting={meeting} user={user} onMeeting={onMeeting} onNotify={onNotify} onError={onError} />

        {meeting.canAccept && (
          <div className="detail-actions stacked">
            <div className="proposed-callout">
              <Clock3 size={18} />
              <p>
                <strong>Шинэ цаг санал болгосон</strong>
                {formatDate(meeting.date)}, {meeting.alternateTime}
              </p>
            </div>
            <button
              className="primary-button wide"
              disabled={busy}
              onClick={() => onStatus({ action: "accept" }, "Шинэ цагийг хүлээн авлаа")}
            >
              {busy ? <LoaderCircle className="spin" size={17} /> : null} Энэ цагийг зөвшөөрөх <Check size={17} />
            </button>
          </div>
        )}
        {!mine && meeting.status === "confirmed" && (
          <button
            className="primary-button wide detail-confirm"
            disabled={busy}
            onClick={() => onStatus({ action: "complete" }, "Уулзалт дууссан гэж тэмдэглэгдлээ")}
          >
            {busy ? <LoaderCircle className="spin" size={17} /> : <CheckCircle2 size={17} />} Уулзалт дууссан
          </button>
        )}
        {ACTIVE.includes(meeting.status) &&
          (confirmCancel ? (
            <div className="cancel-confirm" role="alert">
              <p>Энэ уулзалтыг цуцлах уу? Нөгөө оролцогчид мэдэгдэл очно.</p>
              <div>
                <button className="secondary-button small" onClick={() => setConfirmCancel(false)} disabled={busy}>
                  Үгүй
                </button>
                <button
                  className="danger-button small"
                  disabled={busy}
                  onClick={() => onStatus({ action: "cancel" }, mine ? "Уулзалтын хүсэлт цуцлагдлаа" : "Уулзалт цуцлагдлаа")}
                >
                  {busy ? <LoaderCircle className="spin" size={15} /> : null} Тийм, цуцлах
                </button>
              </div>
            </div>
          ) : (
            <button className="danger-text" onClick={() => setConfirmCancel(true)}>
              {mine && meeting.initiator === "employee" ? "Хүсэлтийг цуцлах" : "Уулзалтыг цуцлах"}
            </button>
          ))}
      </div>
    </div>
  )
}

function RescheduleModal({
  meeting,
  busy,
  onClose,
  onSubmit,
}: {
  meeting: Meeting
  busy: boolean
  onClose: () => void
  onSubmit: (date: string, time: string) => void
}) {
  const days = useMemo(buildDays, [])
  const [date, setDate] = useState(days.some((d) => d.value === meeting.date) ? meeting.date : days[0].value)
  const [time, setTime] = useState("")
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Өөр цаг санал болгох">
      <div className="small-modal page-enter">
        <div className="modal-header">
          <div>
            <span className="mini-label">ШИНЭ САНАЛ</span>
            <h2>Өөр цаг санал болгох</h2>
            <p>{meeting.isMine ? meeting.manager : meeting.employee}-д тохирох шинэ цаг сонгоорой.</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Хаах">
            <X size={20} />
          </button>
        </div>
        <label className="field-label">Өдөр</label>
        <div className="day-picker modal-days">
          {days.slice(0, 5).map((day) => (
            <button key={day.value} className={date === day.value ? "selected" : ""} onClick={() => setDate(day.value)}>
              <span>{day.day}</span>
              <strong>{day.number}</strong>
            </button>
          ))}
        </div>
        <label className="field-label">Цаг</label>
        <div className="time-grid">
          {TIMES.map((item) => (
            <button key={item} className={time === item ? "selected" : ""} onClick={() => setTime(item)}>
              {item}
            </button>
          ))}
        </div>
        <div className="modal-actions">
          <button className="secondary-button" onClick={onClose} disabled={busy}>
            Болих
          </button>
          <button className="primary-button" disabled={!time || busy} onClick={() => onSubmit(date, time)}>
            {busy ? <LoaderCircle className="spin" size={17} /> : null} Санал илгээх <ArrowRight size={17} />
          </button>
        </div>
      </div>
    </div>
  )
}


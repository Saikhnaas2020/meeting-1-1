export type Role = "employee" | "manager" | "hr"
export type Status = "pending" | "proposed" | "confirmed" | "completed" | "cancelled"
export type RecipientType = "manager" | "hr"
export type MeetingMode = "Биечлэн" | "Microsoft Teams"
export type NextStep = "yes" | "partly" | "no"

export type SessionUser = {
  id: string
  name: string
  initials: string
  email: string
  role: Role
  managerId: string | null
  jobTitle: string | null
}

export type FollowUp = {
  id: string
  task: string
  owner: string
  ownerIsMe: boolean
  due: string | null
  done: boolean
}

export type Initiator = "employee" | "manager" | "hr"

/** Shape sent to the browser. Never contains private notes. */
export type Meeting = {
  id: string
  /** True when the viewer is the employee side of this conversation. */
  isMine: boolean
  initiator: Initiator
  /** Viewer can confirm or propose a new time (they did not start it). */
  canRespond: boolean
  /** Viewer started it and the other side proposed a new time. */
  canAccept: boolean
  type: import("./guides").MeetingType
  typeLabel: string
  purpose?: string
  agenda: string[]
  recipientType: RecipientType
  employee: string
  employeeInitials: string
  employeeId: string
  manager: string
  managerInitials: string
  topics: string[]
  note?: string
  date: string
  time: string
  backupTime?: string
  alternateTime?: string
  duration: string
  mode: MeetingMode
  status: Status
  createdAt: number
  followUps: FollowUp[]
  pulseSubmitted: boolean
}

export const HR_TEAM_NAME = "Хүний нөөцийн баг"

export const TIMES = ["09:30", "10:30", "11:30", "14:00", "15:30", "17:00"]

export const MODE_LABEL: Record<"in_person" | "teams", MeetingMode> = {
  in_person: "Биечлэн",
  teams: "Microsoft Teams",
}

export const MANAGER_TOPICS = [
  "Ажлын гүйцэтгэл",
  "Карьер, хөгжил",
  "Ажлын ачаалал",
  "Хамтын ажиллагаа",
  "Санал, санаачилга",
  "Бусад",
]

export const HR_TOPICS = [
  "Ажлын орчин",
  "Ажил, амьдралын тэнцвэр",
  "Карьер, хөгжил",
  "Халамж, хангамж",
  "Санал, хүсэлт",
  "Бусад",
]

/** Aggregate pulse results are hidden until at least this many responses exist. */
export const MIN_REPORTING = 3

export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

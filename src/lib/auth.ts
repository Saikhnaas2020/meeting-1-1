import crypto from "crypto"
import bcrypt from "bcryptjs"
import { cookies } from "next/headers"
import { query } from "./db"
import { AppError, type Role, type SessionUser } from "./types"

const COOKIE = "my11_session"
const SESSION_HOURS = 8
// Used so that unknown e-mails take as long as wrong passwords (no user enumeration by timing).
const DUMMY_HASH = bcrypt.hashSync("my11-dummy-password", 10)

const failedLogins = new Map<string, { count: number; until: number }>()

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex")
}

type UserRow = {
  id: string
  name: string
  initials: string
  email: string
  role: Role
  manager_id: string | null
  job_title: string | null
  password_hash: string
}

function toSessionUser(row: UserRow): SessionUser {
  return {
    id: row.id,
    name: row.name,
    initials: row.initials,
    email: row.email,
    role: row.role,
    managerId: row.manager_id,
    jobTitle: row.job_title,
  }
}

export async function verifyCredentials(emailRaw: string, password: string): Promise<SessionUser> {
  const email = emailRaw.trim().toLowerCase()
  const lock = failedLogins.get(email)
  if (lock && lock.count >= 5 && lock.until > Date.now()) {
    throw new AppError(429, "Олон удаа буруу оролдлоо. 15 минутын дараа дахин оролдоно уу.")
  }
  const rows = await query<UserRow>("SELECT * FROM users WHERE email = $1", [email])
  const ok = await bcrypt.compare(password, rows[0]?.password_hash ?? DUMMY_HASH)
  if (!rows[0] || !ok) {
    const prev = failedLogins.get(email)
    failedLogins.set(email, { count: (prev?.count ?? 0) + 1, until: Date.now() + 15 * 60_000 })
    throw new AppError(401, "И-мэйл эсвэл нууц үг буруу байна.")
  }
  failedLogins.delete(email)
  return toSessionUser(rows[0])
}

export async function createSession(userId: string) {
  const token = crypto.randomBytes(32).toString("base64url")
  const expires = new Date(Date.now() + SESSION_HOURS * 3600_000)
  await query("DELETE FROM sessions WHERE expires_at < now()")
  await query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)", [
    hashToken(token),
    userId,
    expires,
  ])
  const jar = await cookies()
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  })
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const jar = await cookies()
  const token = jar.get(COOKIE)?.value
  if (!token) return null
  const rows = await query<UserRow>(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashToken(token)],
  )
  return rows[0] ? toSessionUser(rows[0]) : null
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser()
  if (!user) throw new AppError(401, "Нэвтэрч орно уу.")
  return user
}

export async function destroySession() {
  const jar = await cookies()
  const token = jar.get(COOKIE)?.value
  if (token) await query("DELETE FROM sessions WHERE token_hash = $1", [hashToken(token)])
  jar.delete(COOKIE)
}

"use client"

import type { Meeting } from "@/lib/types"

// ---------- API ----------

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

export async function api<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      method,
      cache: "no-store",
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError(0, "Сүлжээний алдаа. Интернэт холболтоо шалгана уу.")
  }
  const data = await res.json().catch(() => ({}))
  if (res.status === 401) {
    window.location.reload()
    throw new ApiError(401, "Нэвтрэх хугацаа дууссан байна.")
  }
  if (!res.ok) throw new ApiError(res.status, data.error || "Алдаа гарлаа. Дахин оролдоно уу.")
  return data as T
}

// ---------- date helpers ----------

export function toDateKey(date: Date) {
  return date.toISOString().split("T")[0]
}

export function buildDays() {
  const days = []
  const labels = ["Ня", "Да", "Мя", "Лх", "Пү", "Ба", "Бя"]
  const today = new Date()
  today.setHours(12, 0, 0, 0)
  for (let i = 1; i <= 7; i++) {
    const date = new Date(today)
    date.setDate(today.getDate() + i)
    days.push({
      value: toDateKey(date),
      day: labels[date.getDay()],
      number: date.getDate(),
      month: date.getMonth() + 1,
    })
  }
  return days
}

// Deterministic formatting (same output on server and browser → no hydration mismatch).
const WEEKDAYS = ["Ням", "Даваа", "Мягмар", "Лхагва", "Пүрэв", "Баасан", "Бямба"]

export function parts(date: string) {
  const [y, m, d] = date.split("-").map(Number)
  return { month: m, day: d, weekday: WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] }
}

export function formatDate(date: string) {
  const p = parts(date)
  return `${p.month}-р сарын ${p.day}, ${p.weekday}`
}

export function shownTime(meeting: Meeting) {
  return meeting.status === "proposed" && meeting.alternateTime ? meeting.alternateTime : meeting.time
}

export function newKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
        (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16),
      )
}

// ---------- small components ----------

export function Avatar({
  initials,
  size = "md",
  green = false,
}: {
  initials: string
  size?: "sm" | "md" | "lg"
  green?: boolean
}) {
  return (
    <span className={`avatar avatar-${size} ${green ? "avatar-green" : ""}`} aria-hidden="true">
      {initials}
    </span>
  )
}

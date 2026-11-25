import { NextResponse } from "next/server"
import { AppError } from "./types"

/** Wrap a route handler: AppError → JSON with its status, anything else → generic 500. */
export async function handle(fn: () => Promise<unknown>, status = 200) {
  try {
    const data = await fn()
    return NextResponse.json(data ?? { ok: true }, { status })
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error(error)
    return NextResponse.json({ error: "Серверийн алдаа гарлаа. Дахин оролдоно уу." }, { status: 500 })
  }
}

export async function readJson(request: Request) {
  // Requiring JSON forces a CORS preflight for cross-site requests (CSRF protection).
  if (!request.headers.get("content-type")?.includes("application/json")) {
    throw new AppError(415, "Content-Type: application/json шаардлагатай.")
  }
  try {
    return await request.json()
  } catch {
    throw new AppError(400, "JSON өгөгдөл буруу байна.")
  }
}

import { requireUser } from "@/lib/auth"
import { handle } from "@/lib/http"
import { listNotifications, markNotificationsRead } from "@/lib/meetings"

export const dynamic = "force-dynamic"

export async function GET() {
  return handle(async () => ({ notifications: await listNotifications(await requireUser()) }))
}

export async function POST() {
  return handle(async () => {
    await markNotificationsRead(await requireUser())
    return { ok: true }
  })
}

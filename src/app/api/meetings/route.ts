import { requireUser } from "@/lib/auth"
import { handle, readJson } from "@/lib/http"
import { createMeeting, listMeetings } from "@/lib/meetings"

export const dynamic = "force-dynamic"

export async function GET() {
  return handle(async () => ({ meetings: await listMeetings(await requireUser()) }))
}

export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser()
    return { meeting: await createMeeting(user, await readJson(request)) }
  }, 201)
}

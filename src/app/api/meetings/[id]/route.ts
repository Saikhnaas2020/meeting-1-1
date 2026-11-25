import { requireUser } from "@/lib/auth"
import { handle, readJson } from "@/lib/http"
import { getMeeting, updateMeetingStatus } from "@/lib/meetings"

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_request: Request, { params }: Ctx) {
  return handle(async () => {
    const user = await requireUser()
    return { meeting: await getMeeting(user, (await params).id) }
  })
}

/** Body: { action: "confirm" | "propose" | "accept" | "cancel" | "complete", date?, time? } */
export async function PATCH(request: Request, { params }: Ctx) {
  return handle(async () => {
    const user = await requireUser()
    return { meeting: await updateMeetingStatus(user, (await params).id, await readJson(request)) }
  })
}

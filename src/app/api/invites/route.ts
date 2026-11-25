import { requireUser } from "@/lib/auth"
import { handle, readJson } from "@/lib/http"
import { inviteMeeting } from "@/lib/meetings"

export const dynamic = "force-dynamic"

/** Manager or HR starts a conversation with an employee. */
export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser()
    return { meeting: await inviteMeeting(user, await readJson(request)) }
  }, 201)
}

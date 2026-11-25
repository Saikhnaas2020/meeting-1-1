import { requireUser } from "@/lib/auth"
import { handle, readJson } from "@/lib/http"
import { setFollowUpDone } from "@/lib/meetings"

type Ctx = { params: Promise<{ id: string }> }

/** Body: { done: boolean } */
export async function PATCH(request: Request, { params }: Ctx) {
  return handle(async () => {
    const user = await requireUser()
    return { meeting: await setFollowUpDone(user, (await params).id, await readJson(request)) }
  })
}

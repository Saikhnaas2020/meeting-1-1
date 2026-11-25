import { requireUser } from "@/lib/auth"
import { handle, readJson } from "@/lib/http"
import { submitPulse } from "@/lib/meetings"

type Ctx = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: Ctx) {
  return handle(async () => {
    const user = await requireUser()
    return { meeting: await submitPulse(user, (await params).id, await readJson(request)) }
  }, 201)
}

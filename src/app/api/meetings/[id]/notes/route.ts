import { requireUser } from "@/lib/auth"
import { handle, readJson } from "@/lib/http"
import { getPrivateNote, savePrivateNote } from "@/lib/meetings"

type Ctx = { params: Promise<{ id: string }> }

/** Returns ONLY the current user's own private note. */
export async function GET(_request: Request, { params }: Ctx) {
  return handle(async () => {
    const user = await requireUser()
    return { note: await getPrivateNote(user, (await params).id) }
  })
}

export async function PUT(request: Request, { params }: Ctx) {
  return handle(async () => {
    const user = await requireUser()
    return { note: await savePrivateNote(user, (await params).id, await readJson(request)) }
  })
}

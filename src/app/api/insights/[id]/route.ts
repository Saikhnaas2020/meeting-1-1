import { requireUser } from "@/lib/auth"
import { handle } from "@/lib/http"
import { getPersonInsight } from "@/lib/meetings"

export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_request: Request, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params
    return { insight: await getPersonInsight(await requireUser(), id) }
  })
}

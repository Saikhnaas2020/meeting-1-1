import { requireUser } from "@/lib/auth"
import { handle } from "@/lib/http"
import { listPeople } from "@/lib/meetings"

export const dynamic = "force-dynamic"

export async function GET() {
  return handle(async () => ({ people: await listPeople(await requireUser()) }))
}

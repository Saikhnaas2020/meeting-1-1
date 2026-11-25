import { requireUser } from "@/lib/auth"
import { handle } from "@/lib/http"
import { getHrMetrics } from "@/lib/meetings"

export const dynamic = "force-dynamic"

export async function GET() {
  return handle(async () => ({ metrics: await getHrMetrics(await requireUser()) }))
}

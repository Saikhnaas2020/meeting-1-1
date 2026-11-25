import { requireUser } from "@/lib/auth"
import { handle } from "@/lib/http"
import { getDepartmentInsights } from "@/lib/meetings"

export const dynamic = "force-dynamic"

export async function GET() {
  return handle(async () => ({ insights: await getDepartmentInsights(await requireUser()) }))
}

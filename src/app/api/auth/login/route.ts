import { z } from "zod"
import { createSession, verifyCredentials } from "@/lib/auth"
import { handle, readJson } from "@/lib/http"
import { AppError } from "@/lib/types"

const schema = z.object({
  email: z.string().trim().min(3).max(200),
  password: z.string().min(1).max(200),
})

export async function POST(request: Request) {
  return handle(async () => {
    const parsed = schema.safeParse(await readJson(request))
    if (!parsed.success) throw new AppError(400, "И-мэйл болон нууц үгээ оруулна уу.")
    const user = await verifyCredentials(parsed.data.email, parsed.data.password)
    await createSession(user.id)
    return { user }
  })
}

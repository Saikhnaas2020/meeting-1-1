import AuthScreen from "@/components/AuthScreen"
import My11App from "@/components/My11App"
import { getCurrentUser } from "@/lib/auth"
import { query } from "@/lib/db"
import { listMeetings } from "@/lib/meetings"

export const dynamic = "force-dynamic"

export default async function Page() {
  const user = await getCurrentUser()
  if (!user) return <AuthScreen showDemo={process.env.SHOW_DEMO_ACCOUNTS !== "false"} />

  const [meetings, manager] = await Promise.all([
    listMeetings(user),
    user.managerId
      ? query<{ name: string }>("SELECT name FROM users WHERE id = $1", [user.managerId])
      : Promise.resolve([]),
  ])
  return <My11App user={user} managerName={manager[0]?.name ?? null} initialMeetings={meetings} />
}

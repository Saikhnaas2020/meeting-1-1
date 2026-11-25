/**
 * Creates the schema and loads FICTIONAL demo data.
 *   npm run db:setup   – create tables, seed if empty
 *   npm run db:reset   – DROP all My 1:1 tables, then recreate and seed
 */
import "dotenv/config"
import fs from "fs"
import path from "path"
import bcrypt from "bcryptjs"
import { Client } from "pg"

const reset = process.argv.includes("--reset")

function dayKey(offset: number) {
  return new Date(Date.now() + 8 * 3600_000 + offset * 86_400_000).toISOString().slice(0, 10)
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL тохируулаагүй байна (.env файлыг шалгана уу).")
  const db = new Client({ connectionString: process.env.DATABASE_URL })
  await db.connect()
  try {
    if (reset) {
      await db.query(`DROP TABLE IF EXISTS activity_log, notifications, conversation_pulse, action_items,
        private_notes, meeting_history, meetings, sessions, users CASCADE`)
      console.log("Хүснэгтүүдийг устгалаа.")
    }
    await db.query(fs.readFileSync(path.join(process.cwd(), "db/schema.sql"), "utf8"))
    console.log("Schema бэлэн.")

    const { rows } = await db.query("SELECT count(*)::int AS n FROM users")
    if (rows[0].n > 0) {
      console.log("Хэрэглэгч аль хэдийн байна — seed алгаслаа.")
      return
    }

    const hash = await bcrypt.hash(process.env.SEED_PASSWORD || "Demo!2026", 10)
    const add = async (
      name: string, initials: string, email: string, role: string,
      dept: string, title: string, managerId: string | null,
    ) => {
      const r = await db.query(
        `INSERT INTO users (name, initials, email, password_hash, role, department, job_title, manager_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [name, initials, email, hash, role, dept, title, managerId],
      )
      return r.rows[0].id as string
    }

    // All people below are fictional.
    const bold = await add("Б. Болд", "ББ", "manager@my11.demo", "manager", "Борлуулалт", "Багийн ахлагч", null)
    const ganzo = await add("Г. Ганзориг", "ГГ", "manager2@my11.demo", "manager", "Сүлжээ", "Хэлтсийн дарга", null)
    const hr = await add("С. Сарантуяа", "СС", "hr@my11.demo", "hr", "Хүний нөөц", "HR бизнес түнш", null)
    const enkh = await add("А. Энхжин", "АЭ", "employee@my11.demo", "employee", "Борлуулалт", "Борлуулалтын мэргэжилтэн", bold)
    const temuulen = await add("Д. Тэмүүлэн", "ДТ", "employee2@my11.demo", "employee", "Борлуулалт", "Account менежер", bold)
    const nomin = await add("Н. Номин", "НН", "employee3@my11.demo", "employee", "Сүлжээ", "Сүлжээний инженер", ganzo)
    void hr

    const meeting = async (values: unknown[]) => {
      const r = await db.query(
        `INSERT INTO meetings (requester_id, recipient_type, recipient_id, topics, note, meeting_date,
                               meeting_time, proposed_time, mode, status, employee_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$1) RETURNING id`,
        values,
      )
      return r.rows[0].id as string
    }

    await meeting([enkh, "manager", bold, ["Карьер, хөгжил"],
      "Дараагийн улиралд хөгжүүлэх ур чадварынхаа талаар ярилцмаар байна.",
      dayKey(3), "14:00", null, "teams", "confirmed"])
    await meeting([temuulen, "manager", bold, ["Хамтын ажиллагаа"],
      "Шинэ төслийн үүргийн хуваарилалтын талаар санал солилцъё.",
      dayKey(2), "10:30", null, "in_person", "pending"])
    const past = await meeting([enkh, "manager", bold, ["Ажлын гүйцэтгэл"], null,
      dayKey(-12), "11:30", null, "in_person", "completed"])
    await meeting([nomin, "hr", null, ["Ажил, амьдралын тэнцвэр"],
      "Ажлын уян хатан цагийн боломжийн талаар тайван ярилцмаар байна.",
      dayKey(5), "11:30", null, "teams", "pending"])

    await db.query(
      `INSERT INTO action_items (meeting_id, title, owner_id, created_by, due_date)
       VALUES ($1, 'Төслийн танилцуулгын эхний хувилбарыг бэлтгэх', $2, $3, $4)`,
      [past, enkh, bold, dayKey(7)],
    )
    await db.query(
      "INSERT INTO private_notes (meeting_id, author_id, content) VALUES ($1, $2, $3), ($1, $4, $5)",
      [past, enkh, "(Энхжиний хувийн тэмдэглэл) Дараагийн удаа сургалтын төсвийн талаар асуух.",
        bold, "(Болдын хувийн тэмдэглэл) Энхжинд ахлах үүрэг санал болгох талаар бодох."],
    )
    console.log("Демо өгөгдөл нэмэгдлээ. Нууц үг:", process.env.SEED_PASSWORD || "Demo!2026")
  } finally {
    await db.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

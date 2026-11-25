/**
 * End-to-end permission & workflow tests against the real database.
 * Requires `npm run db:setup` first. Test meetings are deleted at the end.
 */
import "dotenv/config"
import assert from "assert/strict"
import crypto from "crypto"
import { pool, query } from "../src/lib/db"
import * as svc from "../src/lib/meetings"
import { AppError, type SessionUser } from "../src/lib/types"

const created: string[] = []
let passed = 0

async function user(email: string): Promise<SessionUser> {
  const [u] = await query<{ id: string; name: string; initials: string; email: string; role: SessionUser["role"]; manager_id: string | null; job_title: string | null }>(
    "SELECT * FROM users WHERE email = $1",
    [email],
  )
  assert.ok(u, `${email} олдсонгүй — эхлээд npm run db:setup ажиллуулна уу`)
  return { id: u.id, name: u.name, initials: u.initials, email: u.email, role: u.role, managerId: u.manager_id, jobTitle: u.job_title }
}

async function expectError(promise: Promise<unknown>, status: number) {
  try {
    await promise
  } catch (error) {
    assert.ok(error instanceof AppError, `AppError хүлээж байсан: ${error}`)
    assert.equal(error.status, status, `статус ${status} хүлээж байсан, ${error.status} ирсэн: ${error.message}`)
    return
  }
  assert.fail(`Алдаа (${status}) гарах ёстой байсан`)
}

async function test(name: string, fn: () => Promise<void>) {
  await fn()
  passed++
  console.log(`  ✓ ${name}`)
}

async function main() {
  const employee = await user("employee@my11.demo")
  const manager = await user("manager@my11.demo")
  const otherManager = await user("manager2@my11.demo")
  const otherEmployee = await user("employee3@my11.demo")
  const hr = await user("hr@my11.demo")
  const SECRET = `SECRET-${crypto.randomUUID()}`
  const key = crypto.randomUUID()
  const base = {
    recipient: "manager",
    topics: ["Карьер, хөгжил"],
    note: "Тест уулзалт",
    date: svc.todayKey(4),
    time: "09:30",
    mode: "Microsoft Teams",
  }
  let meetingId = ""

  console.log("My 1:1 — эрх ба урсгалын тест\n")

  await test("Ажилтан удирдлагадаа уулзалтын хүсэлт үүсгэнэ", async () => {
    const m = await svc.createMeeting(employee, { ...base, requestKey: key })
    meetingId = m.id
    created.push(m.id)
    assert.equal(m.status, "pending")
    assert.equal(m.manager, manager.name)
  })

  await test("Давхар илгээлт (ижил requestKey) шинэ уулзалт үүсгэхгүй", async () => {
    const again = await svc.createMeeting(employee, { ...base, requestKey: key })
    assert.equal(again.id, meetingId)
    const [{ n }] = await query<{ n: number }>("SELECT count(*)::int AS n FROM meetings WHERE request_key = $1", [key])
    assert.equal(n, 1)
  })

  await test("Серверийн validation: хоосон сэдэв, өнгөрсөн огноо, буруу сэдэв, буруу ID", async () => {
    await expectError(svc.createMeeting(employee, { ...base, topics: [], requestKey: crypto.randomUUID() }), 400)
    await expectError(svc.createMeeting(employee, { ...base, date: svc.todayKey(-1), requestKey: crypto.randomUUID() }), 400)
    await expectError(svc.createMeeting(employee, { ...base, topics: ["Хакердах"], requestKey: crypto.randomUUID() }), 400)
    await expectError(svc.getMeeting(employee, "not-a-uuid"), 400)
  })

  await test("Өөр багийн удирдлага, өөр ажилтан, HR энэ уулзалтыг харахгүй", async () => {
    await expectError(svc.getMeeting(otherManager, meetingId), 404)
    await expectError(svc.getMeeting(otherEmployee, meetingId), 404)
    await expectError(svc.getMeeting(hr, meetingId), 404)
    assert.ok(!(await svc.listMeetings(hr)).some((m) => m.id === meetingId))
  })

  await test("Ажилтан өөрийн хүсэлтийг батлах, шинэ цаг санал болгох эрхгүй", async () => {
    await expectError(svc.updateMeetingStatus(employee, meetingId, { action: "confirm" }), 403)
    await expectError(svc.updateMeetingStatus(employee, meetingId, { action: "propose", date: svc.todayKey(5), time: "10:30" }), 403)
  })

  await test("Удирдлага баталгаажуулна → хоёулаа confirmed харна", async () => {
    const m = await svc.updateMeetingStatus(manager, meetingId, { action: "confirm" })
    assert.equal(m.status, "confirmed")
    const mine = (await svc.listMeetings(employee)).find((x) => x.id === meetingId)
    assert.equal(mine?.status, "confirmed")
  })

  await test("Ажилтны хувийн тэмдэглэлийг удирдлага, HR унших боломжгүй", async () => {
    await svc.savePrivateNote(employee, meetingId, { content: SECRET })
    assert.equal((await svc.getPrivateNote(employee, meetingId)).content, SECRET)
    assert.equal((await svc.getPrivateNote(manager, meetingId)).content, "")
    await expectError(svc.getPrivateNote(hr, meetingId), 404)
    assert.ok(!JSON.stringify(await svc.listMeetings(manager)).includes(SECRET))
    assert.ok(!JSON.stringify(await svc.getMeeting(manager, meetingId)).includes(SECRET))
  })

  await test("Удирдлага ажил оноох; ажилтан бусдад ажил оноох эрхгүй", async () => {
    await expectError(svc.createFollowUp(employee, meetingId, { task: "Удирдлагад оноох", ownerId: manager.id }), 403)
    await expectError(svc.createFollowUp(manager, meetingId, { task: "Гадны хүнд", ownerId: otherEmployee.id }), 400)
    const m = await svc.createFollowUp(manager, meetingId, { task: "Сургалтын төлөвлөгөө гаргах", ownerId: employee.id, due: svc.todayKey(10) })
    assert.equal(m.followUps.length, 1)
  })

  await test("Ажилтан оноогдсон ажлаа харж, дуусгана; өөр хүн өөрчлөх эрхгүй", async () => {
    const m = await svc.getMeeting(employee, meetingId)
    const item = m.followUps[0]
    assert.ok(item.ownerIsMe)
    await expectError(svc.setFollowUpDone(otherManager, item.id, { done: true }), 404)
    const updated = await svc.setFollowUpDone(employee, item.id, { done: true })
    assert.ok(updated.followUps[0].done)
  })

  await test("Уулзалтыг зөвхөн удирдлага дуусгана", async () => {
    await expectError(svc.updateMeetingStatus(employee, meetingId, { action: "complete" }), 403)
    const m = await svc.updateMeetingStatus(manager, meetingId, { action: "complete" })
    assert.equal(m.status, "completed")
  })

  await test("Conversation pulse нэг удаа илгээгдэнэ", async () => {
    const m = await svc.submitPulse(employee, meetingId, { rating: 5, nextStep: "yes", feedback: SECRET })
    assert.ok(m.pulseSubmitted)
    await expectError(svc.submitPulse(employee, meetingId, { rating: 4, nextStep: "partly" }), 409)
    await expectError(svc.submitPulse(otherEmployee, meetingId, { rating: 1, nextStep: "no" }), 404)
  })

  await test("HR нэгтгэсэн үзүүлэлт харна, гэхдээ агуулга/тэмдэглэл харахгүй; удирдлага хандах эрхгүй", async () => {
    const metrics = await svc.getHrMetrics(hr)
    assert.ok(metrics.total >= 1)
    assert.ok(!JSON.stringify(metrics).includes(SECRET))
    await expectError(svc.getHrMetrics(manager), 403)
    await expectError(svc.getHrMetrics(employee), 403)
  })

  await test("HR урсгал: ажилтан HR-т хүсэлт → HR цаг санал болгоно → ажилтан зөвшөөрнө", async () => {
    const m = await svc.createMeeting(employee, {
      ...base,
      recipient: "hr",
      topics: ["Ажил, амьдралын тэнцвэр"],
      requestKey: crypto.randomUUID(),
    })
    created.push(m.id)
    await expectError(svc.getMeeting(manager, m.id), 404) // удирдлага HR-тэй ярианы талаар мэдэхгүй
    const proposed = await svc.updateMeetingStatus(hr, m.id, { action: "propose", date: svc.todayKey(6), time: "15:30" })
    assert.equal(proposed.status, "proposed")
    assert.equal(proposed.alternateTime, "15:30")
    await expectError(svc.updateMeetingStatus(hr, m.id, { action: "accept" }), 403)
    const accepted = await svc.updateMeetingStatus(employee, m.id, { action: "accept" })
    assert.equal(accepted.status, "confirmed")
    assert.equal(accepted.time, "15:30")
  })

  await test("Цуцалсан уулзалтыг дахин батлах боломжгүй", async () => {
    const m = await svc.createMeeting(employee, { ...base, requestKey: crypto.randomUUID() })
    created.push(m.id)
    await svc.updateMeetingStatus(employee, m.id, { action: "cancel" })
    await expectError(svc.updateMeetingStatus(manager, m.id, { action: "confirm" }), 409)
  })

  await test("Мэдэгдэл (notification) өгөгдлийн санд үүснэ", async () => {
    const list = await svc.listNotifications(manager)
    assert.ok(list.some((n) => n.meeting_id === meetingId))
  })

  const invite = {
    type: "career",
    purpose: "Хөгжлийн төлөвлөгөө ярилцъя",
    agenda: ["1–3 жилийн зорилго"],
    date: svc.todayKey(5),
    time: "10:30",
    mode: "Биечлэн",
  }

  await test("Удирдлага багийн ажилтнаа урина → ажилтан батална; удирдлага өөрөө батлах эрхгүй", async () => {
    const m = await svc.inviteMeeting(manager, { ...invite, employeeId: employee.id, requestKey: crypto.randomUUID() })
    created.push(m.id)
    assert.equal(m.initiator, "manager")
    assert.equal(m.type, "career")
    assert.ok(!m.isMine && !m.canRespond)
    await expectError(svc.updateMeetingStatus(manager, m.id, { action: "confirm" }), 403)
    const seen = await svc.getMeeting(employee, m.id)
    assert.ok(seen.isMine && seen.canRespond)
    assert.deepEqual(seen.agenda, invite.agenda)
    const confirmed = await svc.updateMeetingStatus(employee, m.id, { action: "confirm" })
    assert.equal(confirmed.status, "confirmed")
    await expectError(svc.updateMeetingStatus(employee, m.id, { action: "complete" }), 403)
  })

  await test("Урилгад ажилтан шинэ цаг санал болговол удирдлага хүлээн авна", async () => {
    const m = await svc.inviteMeeting(manager, { ...invite, type: "general", employeeId: employee.id, requestKey: crypto.randomUUID() })
    created.push(m.id)
    await svc.updateMeetingStatus(employee, m.id, { action: "propose", date: svc.todayKey(6), time: "15:30" })
    await expectError(svc.updateMeetingStatus(employee, m.id, { action: "accept" }), 403)
    const accepted = await svc.updateMeetingStatus(manager, m.id, { action: "accept" })
    assert.equal(accepted.status, "confirmed")
  })

  await test("Урилгын эрх: ажилтан, өөр багийн удирдлага, HR-ын бус төрөл хориотой", async () => {
    await expectError(svc.inviteMeeting(employee, { ...invite, employeeId: manager.id, requestKey: crypto.randomUUID() }), 403)
    await expectError(svc.inviteMeeting(otherManager, { ...invite, employeeId: employee.id, requestKey: crypto.randomUUID() }), 403)
    await expectError(svc.inviteMeeting(manager, { ...invite, type: "onboarding", employeeId: employee.id, requestKey: crypto.randomUUID() }), 400)
    await expectError(svc.inviteMeeting(manager, { ...invite, agenda: [], employeeId: employee.id, requestKey: crypto.randomUUID() }), 400)
  })

  await test("HR stay interview санаачилна; удирдлага тэр яриаг харахгүй", async () => {
    const m = await svc.inviteMeeting(hr, { ...invite, type: "stay_interview", employeeId: employee.id, requestKey: crypto.randomUUID() })
    created.push(m.id)
    assert.equal(m.recipientType, "hr")
    await expectError(svc.getMeeting(manager, m.id), 404)
    const seen = await svc.getMeeting(employee, m.id)
    assert.ok(seen.canRespond)
  })

  await test("Хүмүүсийн жагсаалт: удирдлага зөвхөн багаа, ажилтан хандах эрхгүй", async () => {
    const team = await svc.listPeople(manager)
    assert.ok(team.some((p) => p.id === employee.id))
    assert.ok(!team.some((p) => p.id === otherEmployee.id))
    await expectError(svc.listPeople(employee), 403)
  })

  await test("Хэлтэс, хувь хүний дүгнэлт зөвхөн HR-т; тэмдэглэл, сэтгэгдэл орохгүй", async () => {
    const dept = await svc.getDepartmentInsights(hr)
    assert.ok(dept.departments.length > 0)
    const person = await svc.getPersonInsight(hr, employee.id)
    assert.ok(person.totals.meetings >= 1)
    const dump = JSON.stringify([dept, person])
    assert.ok(!dump.includes(SECRET))
    await expectError(svc.getDepartmentInsights(manager), 403)
    await expectError(svc.getPersonInsight(manager, employee.id), 403)
    await expectError(svc.getPersonInsight(employee, employee.id), 403)
  })

  console.log(`\nБүгд амжилттай: ${passed} тест`)
}

main()
  .catch((error) => {
    console.error("\n✗ ТЕСТ АМЖИЛТГҮЙ:", error.message ?? error)
    process.exitCode = 1
  })
  .finally(async () => {
    if (created.length) await query("DELETE FROM meetings WHERE id = ANY($1::uuid[])", [created])
    await pool.end()
  })

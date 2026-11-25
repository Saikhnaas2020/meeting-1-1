# My 1:1 — 1:1 уулзалтын апп

Ажилтан, удирдлага, HR гурван үүрэгтэй 1:1 уулзалтын веб апп.
**Next.js 16 + React 19 + PostgreSQL + Node.js.** UI нь өмнөх Figma Make дизайныг хадгалсан.

## Ажиллуулах (Windows)

Шаардлага: **Node.js 20+**, **PostgreSQL 14+**

```powershell
# 1. Өгөгдлийн сан үүсгэх
psql -U postgres -h localhost -c "CREATE DATABASE my11;"

# 2. Тохиргоо
copy .env.example .env
notepad .env        # DATABASE_URL дотор PASSWORD-оо солино

# 3. Суулгах, хүснэгт үүсгэх, демо өгөгдөл оруулах
npm install
npm run db:setup

# 4. Ажиллуулах
npm run dev
```

Хөтөч дээр **http://localhost:3000** хаягийг нээнэ.

### Туршилтын хэрэглэгчид (бүгд зохиомол, нууц үг `Demo!2026`)

| Үүрэг | И-мэйл | Нэр |
|---|---|---|
| Ажилтан | employee@my11.demo | А. Эрдэнэсайхан (удирдлага: Б. Азжаргал) |
| Ажилтан | employee2@my11.demo | Д. Тэмүүлэн (удирдлага: Б. Азжаргал) |
| Ажилтан | employee3@my11.demo | Н. Номин (удирдлага: Г. Ганзориг) |
| Удирдлага | manager@my11.demo | Б. Азжаргал |
| Удирдлага | manager2@my11.demo | Г. Ганзориг |
| HR | hr@my11.demo | Ч. Түвшинзаяа |

## Командууд

| Команд | Үйлдэл |
|---|---|
| `npm run dev` | Хөгжүүлэлтийн сервер |
| `npm run build` / `npm start` | Production build ба ажиллуулах |
| `npm run db:setup` | Хүснэгт үүсгэж, хоосон бол демо өгөгдөл оруулна |
| `npm run db:reset` | **Бүх өгөгдлийг устгаж** дахин үүсгэнэ |
| `npm test` | Эрх ба урсгалын 15 тест (бодит DB дээр) |
| `npm run typecheck` | TypeScript шалгалт |

## Боломжууд

- **Нэвтрэлт:** и-мэйл/нууц үг (bcrypt), 8 цагийн HttpOnly session cookie, 5 буруу оролдлогын дараа 15 минут түгжинэ
- **Ажилтан:** шууд удирдлага эсвэл HR-т хүсэлт илгээх, санал болгосон цагийг зөвшөөрөх, цуцлах, оноогдсон ажлаа дуусгах, Conversation Pulse илгээх
- **Удирдлага:** зөвхөн өөрийн шууд харьяа ажилтны хүсэлтийг харах, батлах, өөр цаг санал болгох, уулзалт дуусгах, follow-up ажил оноох
- **HR:** HR-т ирсэн хүсэлтүүдийг шийдвэрлэх, байгууллагын нэгтгэсэн үзүүлэлт (3-аас доош хариулттай бол Pulse дүнг нууна)
- **Хувийн тэмдэглэл:** зөвхөн бичсэн хүнд харагдана, жагсаалт, үзүүлэлт, бусдын хариунд хэзээ ч орохгүй
- **Төлөв:** pending → proposed → confirmed → completed / cancelled, бүх өөрчлөлт `meeting_history`-д бүртгэгдэнэ
- **Мэдэгдэл:** `notifications` хүснэгтэд хадгалагдана (`GET /api/notifications`)
- **Давхар илгээлтээс хамгаалалт:** хүсэлт бүр `requestKey`-тэй, DB дээр UNIQUE

## Аюулгүй байдал

- Бүх эрхийн шалгалт **сервер дээр** (`src/lib/meetings.ts`). Хөтчөөс ирсэн role-д итгэхгүй, хэрэглэгчийн role-ийг зөвхөн session-оос уншина.
- Хандах эрхгүй уулзалт **404** буцаана, ингэснээр уулзалт байгаа эсэх нь ч ил гарахгүй.
- Удирдлага HR-тэй хийсэн уулзалтыг харахгүй, HR удирдлага-ажилтны уулзалтыг харахгүй.
- Бүх оролтыг сервер дээр zod-оор шалгана. SQL query бүр parameterized.
- POST/PATCH/PUT нь `Content-Type: application/json` шаарддаг (CSRF хамгаалалт).
- `activity_log` хэн юу хийснийг бүртгэнэ, тэмдэглэлийн агуулгыг бүртгэхгүй.

## API (Postman)

`postman/My11.postman_collection.json` файлыг Postman руу Import хийнэ. Эхлээд **Login** хүсэлтийг илгээвэл cookie автоматаар хадгалагдана.

| Method | Зам | Тайлбар |
|---|---|---|
| POST | `/api/auth/login` | `{ email, password }` |
| POST | `/api/auth/logout` | |
| GET / POST | `/api/meetings` | Миний харах эрхтэй уулзалтууд / шинэ хүсэлт |
| GET / PATCH | `/api/meetings/:id` | `{ action: confirm \| propose \| accept \| cancel \| complete, date?, time? }` |
| GET / PUT | `/api/meetings/:id/notes` | Зөвхөн өөрийн хувийн тэмдэглэл |
| POST | `/api/meetings/:id/follow-ups` | `{ task, ownerId, due? }` (удирдлага/HR) |
| PATCH | `/api/follow-ups/:id` | `{ done: true }` |
| POST | `/api/meetings/:id/pulse` | `{ rating: 1-5, nextStep: yes\|partly\|no, feedback? }` |
| GET | `/api/metrics` | Зөвхөн HR |
| GET / POST | `/api/notifications` | Жагсаалт / бүгдийг уншсан болгох |

## Production руу гаргахын өмнө

1. Демо хэрэглэгчдийг устгаж, жинхэнэ хэрэглэгч оруулна (эсвэл байгууллагын SSO буюу Microsoft Entra ID холбоно). Нэвтрэх хуудасны демо жагсаалтыг нуухын тулд `SHOW_DEMO_ACCOUNTS=false` гэж тохируулна.
2. **HTTPS** ашиглана (production-д cookie `Secure` тул HTTP дээр нэвтрэлт ажиллахгүй).
3. PostgreSQL-д зөвхөн энэ апп-д зориулсан, хязгаарлагдмал эрхтэй хэрэглэгч үүсгэнэ.
4. Login-ийн хязгаарлалт одоогоор серверийн санах ойд хадгалагддаг. Олон сервер ажиллуулах бол Redis эсвэл DB рүү шилжүүлнэ.
5. Email, Outlook/Teams календарь, AI Copilot одоогоор холбогдоогүй.

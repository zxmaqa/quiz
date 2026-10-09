import { Link } from 'react-router-dom'

const MATH_GROUP = '11111111-1111-4111-8111-111111111111'
const CHEM_GROUP = '44444444-4444-4444-8444-444444444444'
const BLIND_QUIZ = 'dba74e94-d631-4163-931d-dbc7bc857b82'
const MATH_QUIZ = '22222222-2222-4222-8222-222222222222'

const cards = [
  {
    title: 'Müəllim — Riyaziyyat (demo)',
    text: 'Quiz yarat (mətn və ya şəkil), QR ilə paylaş, nəticəyə bax.',
    to: `/t/${MATH_GROUP}`,
  },
  {
    title: 'Müəllim — Kimya (real müəllimin testi)',
    text: 'Real MİQ kimya quizləri və avtomatik mövzular.',
    to: `/t/${CHEM_GROUP}`,
  },
  {
    title: 'Sinif xəritəsi — kor test',
    text: '20 şagirdin mövzu xəritəsi və AI təhlili.',
    to: `/t/${CHEM_GROUP}/r/${BLIND_QUIZ}`,
  },
  {
    title: 'Şagird kimi sına',
    text: 'Quizi həll et, balını, zəif mövzularını və yoxlanılmış həlli gör.',
    to: `/q/${MATH_QUIZ}`,
  },
  {
    title: 'Menecer paneli',
    text: 'Bütün qruplar, zəif mövzular, qənaət olunan müəllim vaxtı.',
    to: '/m',
  },
]

export default function Guide() {
  return (
    <main className="mx-auto max-w-[1024px] space-y-4 p-4">
      <h1 className="text-2xl font-bold">Demo bələdçisi</h1>
      <div className="grid gap-4 md:grid-cols-2">
        {cards.map((c) => (
          <section key={c.to} className="card flex flex-col gap-4">
            <div className="flex-1 space-y-1">
              <h2 className="text-lg font-semibold">{c.title}</h2>
              <p className="text-muted">{c.text}</p>
            </div>
            <Link to={c.to} className="btn btn-primary w-full">
              Aç
            </Link>
          </section>
        ))}
      </div>
      <p className="text-sm text-muted">{"Demo məlumatları: 'Demo —' qrupları süni datadır."}</p>
    </main>
  )
}

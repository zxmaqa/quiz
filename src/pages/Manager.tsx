import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { score, status, UNSURE, type Answers, type Question } from '../lib/scoring'
import { supabase } from '../lib/supabase'
import { topicName } from '../lib/topicNames'

// Average minutes a teacher spends checking one sheet (teachers' estimate: 1.5-2 min).
const MINUTES_PER_SHEET = 1.75

type Group = { id: string; name: string }
type Quiz = { id: string; group_id: string; title: string; created_at: string }
type Sub = { quiz_id: string; answers: Answers }

const comma = (n: number, digits = 1) => n.toFixed(digits).replace('.', ',')

export default function Manager() {
  const [data, setData] = useState<{ groups: Group[]; quizzes: Quiz[]; questions: Question[]; subs: Sub[] } | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    Promise.all([
      supabase.from('groups').select('id,name').order('name'),
      supabase.from('quizzes').select('id,group_id,title,created_at'),
      supabase.from('questions').select('*'),
      supabase.from('submissions').select('quiz_id,answers'),
    ]).then(([g, qz, qs, subs]) => {
      if (g.error || qz.error || qs.error || subs.error) setFailed(true)
      else
        setData({
          groups: g.data as Group[],
          quizzes: qz.data as Quiz[],
          questions: qs.data as Question[],
          subs: subs.data as Sub[],
        })
    })
  }, [])

  return (
    <main className="mx-auto max-w-[1024px] space-y-4 p-4">
      <h1 className="text-2xl font-bold">Qruplar</h1>
      {failed && (
        <p role="alert" className="rounded-input bg-warn-bg p-3 text-warn">
          Xəta baş verdi. Səhifəni yeniləyin.
        </p>
      )}
      {!failed && !data && <p className="text-muted">Yüklənir…</p>}
      <div className="grid gap-4 md:grid-cols-2">
        {data?.groups.map((group) => (
          <GroupCard key={group.id} group={group} {...data} />
        ))}
      </div>
    </main>
  )
}

function GroupCard({
  group,
  quizzes,
  questions,
  subs,
}: {
  group: Group
  quizzes: Quiz[]
  questions: Question[]
  subs: Sub[]
}) {
  const groupQuizzes = quizzes.filter((q) => q.group_id === group.id)
  const questionsOf = (quizId: string) => questions.filter((q) => (q as Question & { quiz_id: string }).quiz_id === quizId)
  const subsOf = (quizId: string) => subs.filter((s) => s.quiz_id === quizId)
  const totalSheets = groupQuizzes.reduce((n, q) => n + subsOf(q.id).length, 0)

  // latest quiz that has at least one submission
  const latest = [...groupQuizzes]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .find((q) => subsOf(q.id).length > 0)
  let latestAverage = '—'
  if (latest) {
    const qs = questionsOf(latest.id)
    const list = subsOf(latest.id)
    const avg = list.reduce((n, s) => n + score(qs, s.answers), 0) / list.length
    latestAverage = `${comma(avg)} / ${qs.length}`
  }

  // weakest topic: lowest accuracy over all answers of the group's quizzes
  const byTopic = new Map<string, { correct: number; total: number }>()
  for (const quiz of groupQuizzes) {
    const qs = questionsOf(quiz.id)
    for (const s of subsOf(quiz.id)) {
      for (const q of qs) {
        if (!q.topic || q.topic === UNSURE) continue
        const t = byTopic.get(q.topic) ?? { correct: 0, total: 0 }
        t.total += 1
        if (status(q, s.answers) === 'correct') t.correct += 1
        byTopic.set(q.topic, t)
      }
    }
  }
  const weakest = [...byTopic.entries()]
    .map(([topic, t]) => ({ topic, accuracy: (100 * t.correct) / t.total }))
    .sort((a, b) => a.accuracy - b.accuracy)[0]

  return (
    <section className="card space-y-4">
      <h2 className="text-lg font-semibold">{group.name}</h2>
      <dl className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted">Quiz sayı</dt>
          <dd className="mono">{groupQuizzes.length}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted">Son quizin orta balı</dt>
          <dd className="mono">{latestAverage}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted">Ən zəif mövzu</dt>
          <dd className="text-right font-semibold">
            {weakest ? (
              <>
                {topicName(weakest.topic)} <span className="mono font-normal text-muted">({Math.round(weakest.accuracy)}%)</span>
              </>
            ) : (
              '—'
            )}
          </dd>
        </div>
        <div className="space-y-1 rounded-input bg-primary-soft p-3">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="font-semibold">Qənaət edilən vaxt</dt>
            <dd className="mono">
              {Math.round(totalSheets * MINUTES_PER_SHEET)} dəq
              <span className="font-sans text-sm text-muted"> · {totalSheets} vərəq</span>
            </dd>
          </div>
          <p className="text-sm text-muted">müəllimlərin dediyi orta vaxt əsasında (1.5–2 dəq / vərəq)</p>
        </div>
      </dl>
      <Link to={`/t/${group.id}`} className="btn btn-secondary w-full">
        Quizlər
      </Link>
    </section>
  )
}

import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import ClassMap from '../components/ClassMap'
import MissedItem from '../components/MissedItem'
import { topicName } from '../lib/topicNames'
import { analyzeStudent, score, status, weakTopics, type Answers, type Question } from '../lib/scoring'

type Submission = { id: string; student_name: string; answers: Answers }

const mark = {
  correct: { symbol: '✓', cls: 'text-ok' },
  wrong: { symbol: '✗', cls: 'text-warn' },
  blank: { symbol: '–', cls: 'text-muted' },
}

export default function Results() {
  const { groupId, quizId = '' } = useParams()
  const [title, setTitle] = useState('')
  const [questions, setQuestions] = useState<Question[]>([])
  const [submissions, setSubmissions] = useState<Submission[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [deleteFailed, setDeleteFailed] = useState(false)

  useEffect(() => {
    Promise.all([
      supabase.from('quizzes').select('title').eq('id', quizId).maybeSingle(),
      supabase.from('questions').select('*').eq('quiz_id', quizId).order('position'),
      supabase.from('submissions').select('id,student_name,answers').eq('quiz_id', quizId).order('created_at'),
    ]).then(([quiz, qs, subs]) => {
      if (quiz.error || qs.error || subs.error || !quiz.data) {
        setFailed(true)
        return
      }
      setTitle(quiz.data.title)
      setQuestions(qs.data as Question[])
      setSubmissions(subs.data as Submission[])
    })
  }, [quizId])

  async function remove(id: string) {
    if (!window.confirm('Bu cavab silinsin?')) return
    setDeleteFailed(false)
    const { error } = await supabase.from('submissions').delete().eq('id', id)
    if (error) setDeleteFailed(true)
    else setSubmissions((list) => list?.filter((s) => s.id !== id) ?? null)
  }

  const percent = (q: Question, kind: 'wrong' | 'blank') =>
    Math.round(
      (100 * (submissions ?? []).filter((s) => status(q, s.answers) === kind).length) /
        (submissions?.length || 1),
    )

  return (
    <main className="mx-auto max-w-[1024px] space-y-4 p-4">
      <Link to={`/t/${groupId}`} className="inline-flex min-h-12 items-center text-primary underline underline-offset-4">
        ← Quizlər
      </Link>
      <h1 className="text-2xl font-bold">{title || 'Nəticələr'}</h1>
      {failed && (
        <p role="alert" className="rounded-input bg-warn-bg p-3 text-warn">
          Xəta baş verdi. Səhifəni yeniləyin.
        </p>
      )}
      {!failed && submissions === null && <p className="text-muted">Yüklənir…</p>}
      {deleteFailed && (
        <p role="alert" className="rounded-input bg-warn-bg p-3 text-warn">
          Silmək alınmadı.
        </p>
      )}
      {submissions?.length === 0 && <p className="text-muted">Hələ cavab yoxdur.</p>}
      {submissions && submissions.length > 0 && (
        <>
          <ClassMap quizId={quizId} questions={questions} students={submissions} />
          <section className="card space-y-3 p-0">
            <h2 className="px-5 pt-5 text-lg font-semibold">Şagirdlər</h2>
            <div className="overflow-x-auto px-5 pb-5">
            <table className="w-full border-collapse text-center text-sm">
              <thead>
                <tr className="border-b-2 border-line">
                  <th className="sticky left-0 bg-card p-2 text-left">Şagird</th>
                  {questions.map((q) => (
                    <th key={q.id} className="mono p-2" title={q.text}>
                      {q.position}
                    </th>
                  ))}
                  <th className="p-2">Bal</th>
                  <th className="p-2 text-left">Zəif mövzular</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody>
                {submissions.map((s) => (
                  <tr key={s.id} className="border-b border-line">
                    <td className="sticky left-0 whitespace-nowrap bg-card p-2 text-left font-semibold">
                      {s.student_name}
                      {analyzeStudent(questions, s.answers).timeRanOut && (
                        <span className="block text-xs font-normal text-muted">vaxt çatmayıb</span>
                      )}
                    </td>
                    {questions.map((q) => {
                      const m = mark[status(q, s.answers)]
                      return (
                        <td key={q.id} className={`p-2 font-bold ${m.cls}`}>
                          {m.symbol}
                        </td>
                      )
                    })}
                    <td className="mono whitespace-nowrap p-2">
                      {score(questions, s.answers)} / {questions.length}
                    </td>
                    <td className={`p-2 text-left ${weakTopics(questions, s.answers).length ? 'bg-warn-bg text-warn' : ''}`}>
                      {weakTopics(questions, s.answers).map(topicName).join(', ') || '—'}
                    </td>
                    <td className="p-2">
                      <button
                        onClick={() => remove(s.id)}
                        className="btn min-h-12 border-2 border-warn bg-card px-4 text-warn hover:bg-warn-bg"
                      >
                        Sil
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line font-semibold">
                  <td className="sticky left-0 bg-card p-2 text-left">Yanlış %</td>
                  {questions.map((q) => (
                    <td key={q.id} className="mono p-2">
                      {percent(q, 'wrong')}%
                    </td>
                  ))}
                  <td colSpan={3} />
                </tr>
                <tr className="font-semibold">
                  <td className="sticky left-0 bg-card p-2 text-left">Boş %</td>
                  {questions.map((q) => (
                    <td key={q.id} className="mono p-2">
                      {percent(q, 'blank')}%
                    </td>
                  ))}
                  <td colSpan={3} />
                </tr>
              </tfoot>
            </table>
            </div>
          </section>
          <section className="card space-y-3">
            <h2 className="text-lg font-semibold">Ehtimal olunan səbəblər</h2>
            {submissions.map((s) => {
              const { missed, strong } = analyzeStudent(questions, s.answers)
              if (missed.length === 0) return null
              return (
                <details key={s.id} className="rounded-input border border-line p-3">
                  <summary className="flex min-h-12 cursor-pointer items-center font-semibold">
                    {s.student_name}
                    {strong.length > 0 && <span className="chip ml-2">güclü siqnal</span>}
                  </summary>
                  <div className="mt-2 space-y-2">
                    {strong.map((x) => (
                      <p key={x.reason} className="rounded-input bg-warn-bg px-3 py-2 text-warn">
                        Güclü siqnal: ehtimal eyni səhv {x.count} dəfə təkrarlanıb — {x.reason}
                      </p>
                    ))}
                    {missed.map((m) => (
                      <MissedItem key={m.q.id} item={m} answerLabel="Cavab" />
                    ))}
                  </div>
                </details>
              )
            })}
          </section>
          <ol className="card space-y-1 text-sm text-muted">
            {questions.map((q) => (
              <li key={q.id}>
                {q.position}. {q.text} <span className="text-muted">({topicName(q.topic)})</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </main>
  )
}

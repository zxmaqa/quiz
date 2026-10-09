import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import ClassMap from '../components/ClassMap'
import MissedItem from '../components/MissedItem'
import { topicName } from '../lib/topicNames'
import { analyzeStudent, score, status, weakTopics, type Answers, type Question } from '../lib/scoring'

type Submission = { id: string; student_name: string; answers: Answers }

const mark = {
  correct: { symbol: '✓', cls: 'text-green-700' },
  wrong: { symbol: '✗', cls: 'text-red-700' },
  blank: { symbol: '–', cls: 'text-gray-500' },
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
    <main className="mx-auto max-w-5xl space-y-4 p-4">
      <Link to={`/t/${groupId}`} className="text-blue-700 underline">
        ← Quizlər
      </Link>
      <h1 className="text-2xl font-bold">{title || 'Nəticələr'}</h1>
      {failed && <p className="text-red-600">Xəta baş verdi. Səhifəni yeniləyin.</p>}
      {!failed && submissions === null && <p>Yüklənir…</p>}
      {deleteFailed && <p className="text-red-600">Silmək alınmadı.</p>}
      {submissions?.length === 0 && <p>Hələ cavab yoxdur.</p>}
      {submissions && submissions.length > 0 && (
        <>
          <ClassMap quizId={quizId} questions={questions} students={submissions} />
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-center text-sm">
              <thead>
                <tr className="border-b-2 border-gray-300">
                  <th className="p-2 text-left">Şagird</th>
                  {questions.map((q) => (
                    <th key={q.id} className="p-2" title={q.text}>
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
                  <tr key={s.id} className="border-b border-gray-200">
                    <td className="p-2 text-left font-medium">
                      {s.student_name}
                      {analyzeStudent(questions, s.answers).timeRanOut && (
                        <span className="block text-xs font-normal text-gray-500">vaxt çatmayıb</span>
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
                    <td className="p-2 font-semibold">
                      {score(questions, s.answers)} / {questions.length}
                    </td>
                    <td className="p-2 text-left">{weakTopics(questions, s.answers).map(topicName).join(', ') || '—'}</td>
                    <td className="p-2">
                      <button onClick={() => remove(s.id)} className="rounded-lg border border-red-600 px-3 py-1 text-red-700">
                        Sil
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-300 font-semibold">
                  <td className="p-2 text-left">Yanlış %</td>
                  {questions.map((q) => (
                    <td key={q.id} className="p-2">
                      {percent(q, 'wrong')}%
                    </td>
                  ))}
                  <td colSpan={3} />
                </tr>
                <tr className="font-semibold">
                  <td className="p-2 text-left">Boş %</td>
                  {questions.map((q) => (
                    <td key={q.id} className="p-2">
                      {percent(q, 'blank')}%
                    </td>
                  ))}
                  <td colSpan={3} />
                </tr>
              </tfoot>
            </table>
          </div>
          <section className="space-y-2">
            <h2 className="font-semibold">Ehtimal olunan səbəblər</h2>
            {submissions.map((s) => {
              const { missed, strong } = analyzeStudent(questions, s.answers)
              if (missed.length === 0) return null
              return (
                <details key={s.id} className="rounded-xl border border-gray-300 p-3">
                  <summary className="cursor-pointer font-medium">
                    {s.student_name}
                    {strong.length > 0 && <span className="ml-2 text-amber-700">güclü siqnal</span>}
                  </summary>
                  <div className="mt-2 space-y-2">
                    {strong.map((x) => (
                      <p key={x.reason} className="text-amber-700">
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
          <ol className="space-y-1 text-sm text-gray-700">
            {questions.map((q) => (
              <li key={q.id}>
                {q.position}. {q.text} <span className="text-gray-500">({topicName(q.topic)})</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </main>
  )
}

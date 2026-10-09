import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { classMap, type Answers, type Question } from '../lib/scoring'
import { topicLabel } from '../lib/topicNames'

type Summary = { focus_topics: { topic: string; students_weak: number; why: string }[]; next_lesson_plan: string[] }

// "Sinif xəritəsi": topic x students table built in code, plus an AI summary built only from per-topic numbers.
export default function ClassMap({
  quizId,
  questions,
  students,
}: {
  quizId: string
  questions: Question[]
  students: { student_name: string; answers: Answers }[]
}) {
  const rows = classMap(questions, students)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [cacheChecked, setCacheChecked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const requested = useRef(false)

  async function generate() {
    setBusy(true)
    setFailed(false)
    // Only per-topic numbers are sent: never student names or answers.
    const stats = rows.map((r) => ({
      topic: topicLabel(r.topic),
      questions: r.questions,
      students: students.length,
      weak_students: r.weakCount,
      avg_accuracy: r.avgAccuracy,
    }))
    const { data, error } = await supabase.functions.invoke('analyze-quiz', {
      body: { step: 'class-summary', quiz_id: quizId, stats },
    })
    if (error || !data?.summary) setFailed(true)
    else setSummary(data.summary as Summary)
    setBusy(false)
  }

  // cached summary first; generate once only if the quiz has none
  useEffect(() => {
    supabase
      .from('quizzes')
      .select('class_summary')
      .eq('id', quizId)
      .maybeSingle()
      .then(({ data }) => {
        const cached = data?.class_summary?.summary as Summary | undefined
        if (cached) setSummary(cached)
        setCacheChecked(true)
      })
  }, [quizId])

  useEffect(() => {
    if (cacheChecked && !summary && rows.length > 0 && students.length > 0 && !requested.current) {
      requested.current = true
      void generate()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheChecked])

  if (rows.length === 0) return null

  return (
    <section className="space-y-3 rounded-xl border border-gray-300 p-3">
      <h2 className="text-lg font-semibold">Sinif xəritəsi</h2>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-center text-sm">
          <thead>
            <tr className="border-b-2 border-gray-300">
              <th className="p-2 text-left">Mövzu</th>
              <th className="p-2">Zəif şagird</th>
              {students.map((s, i) => (
                <th key={i} className="p-2 font-normal">
                  {s.student_name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.topic} className="border-b border-gray-200">
                <td className="p-2 text-left font-medium">{topicLabel(r.topic)}</td>
                <td className="p-2 font-semibold">
                  {r.weakCount} / {students.length}
                </td>
                {r.cells.map((c, i) => (
                  <td key={i} className={`p-2 ${c.weak ? 'bg-red-100 font-semibold text-red-700' : ''}`}>
                    {c.accuracy}%
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold">AI təhlili · ehtimal</h3>
          <button
            disabled={busy}
            onClick={generate}
            className="rounded-lg border-2 border-blue-700 px-3 py-1 text-sm font-semibold text-blue-700 disabled:opacity-40"
          >
            {busy ? 'Yenilənir…' : 'Yenilə'}
          </button>
        </div>
        {failed && <p className="text-sm text-red-600">AI xətası. Bir az sonra yenidən cəhd edin.</p>}
        {summary && summary.focus_topics.length === 0 && summary.next_lesson_plan.length === 0 && (
          <p className="text-sm">Fokus mövzu tapılmadı.</p>
        )}
        {summary?.focus_topics.map((f) => (
          <p key={f.topic} className="text-sm">
            <span className="font-medium">
              {f.topic} ({f.students_weak} şagird):
            </span>{' '}
            {f.why}
          </p>
        ))}
        {summary && summary.next_lesson_plan.length > 0 && (
          <ol className="list-decimal pl-5 text-sm">
            {summary.next_lesson_plan.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ol>
        )}
      </div>
    </section>
  )
}

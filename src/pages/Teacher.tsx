import { useCallback, useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Link, useParams } from 'react-router-dom'
import NewQuiz from '../components/NewQuiz'
import { extract, solveAndStore, withoutCorrect, writeReasons } from '../lib/ai'
import type { Question } from '../lib/scoring'
import { supabase } from '../lib/supabase'

type Quiz = { id: string; title: string; status: string }

export default function Teacher() {
  const { groupId = '' } = useParams()
  const [quizzes, setQuizzes] = useState<Quiz[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [creating, setCreating] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [notes, setNotes] = useState<Record<string, string>>({})

  const refresh = useCallback(() => {
    supabase
      .from('quizzes')
      .select('id,title,status')
      .eq('group_id', groupId)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) setFailed(true)
        else setQuizzes(data as Quiz[])
      })
  }, [groupId])

  useEffect(refresh, [refresh])

  // Fills topics and reasons only. Correct answers are never changed.
  async function analyzeExisting(quizId: string) {
    const note = (msg: string) => setNotes((n) => ({ ...n, [quizId]: msg }))
    setBusyId(quizId)
    note('')
    try {
      const { data, error } = await supabase
        .from('questions')
        .select('*')
        .eq('quiz_id', quizId)
        .order('position')
      if (error) throw error
      const questions = data as Question[]
      const text = questions
        .map((q) => `${q.position}. ${q.text}\n${q.options.map((o) => `${o.label}) ${o.text}`).join('\n')}`)
        .join('\n\n')
      // call 1 fills topics, call 2 gets the stored correct answers and writes the reasons
      const topics = await extract(text, groupId)
      const reasons = await writeReasons(
        questions.map((q) => ({
          position: q.position,
          text: q.text,
          options: q.options,
          correct_label: q.correct_label,
        })),
        quizId,
        groupId,
      )
      const results = await Promise.all(
        questions.map((q) => {
          const topic = topics.questions.find((a) => a.position === q.position)?.topic
          const m = reasons[q.position]
          return supabase
            .from('questions')
            .update({
              ...(topic ? { topic } : {}),
              misconceptions: m ? withoutCorrect(m, q.correct_label) : null,
            })
            .eq('id', q.id)
        }),
      )
      // verified worked solutions (solve mode)
      const solved = await solveAndStore(quizId, questions)
      note(results.some((r) => r.error) || !solved ? 'Yadda saxlamaq alınmadı.' : 'AI analiz tamamlandı.')
    } catch {
      note('AI xətası. Bir az sonra yenidən cəhd edin.')
    }
    setBusyId('')
  }

  return (
    <main className="mx-auto max-w-xl space-y-4 p-4">
      <h1 className="text-2xl font-bold">Quizlər</h1>
      {creating ? (
        <>
          <NewQuiz
            groupId={groupId}
            onSaved={() => {
              setCreating(false)
              refresh()
            }}
          />
          <button onClick={() => setCreating(false)} className="text-blue-700 underline">
            Ləğv et
          </button>
        </>
      ) : (
        <button
          onClick={() => setCreating(true)}
          className="w-full rounded-xl bg-green-700 p-3 font-semibold text-white"
        >
          Yeni quiz
        </button>
      )}
      {failed && <p className="text-red-600">Xəta baş verdi. Səhifəni yeniləyin.</p>}
      {!failed && quizzes === null && <p>Yüklənir…</p>}
      {quizzes?.length === 0 && <p>Bu qrupda quiz yoxdur.</p>}
      {!creating &&
        quizzes?.map((quiz) => {
          const link = `${window.location.origin}/q/${quiz.id}`
          return (
            <section key={quiz.id} className="space-y-3 rounded-xl border border-gray-300 p-4">
              <h2 className="text-lg font-semibold">{quiz.title}</h2>
              <p className="text-sm text-gray-600">
                Status: {quiz.status === 'live' ? 'Aktiv' : 'Qaralama'}
              </p>
              {quiz.status === 'live' && (
                <div className="space-y-2">
                  <p className="text-sm">Şagird linki:</p>
                  <a href={link} className="break-all text-blue-700 underline">
                    {link}
                  </a>
                  <div className="inline-block rounded-lg bg-white p-3">
                    <QRCodeSVG value={link} size={176} />
                  </div>
                </div>
              )}
              <Link
                to={`/t/${groupId}/r/${quiz.id}`}
                className="block rounded-lg bg-blue-700 px-4 py-3 text-center font-semibold text-white"
              >
                Nəticələr
              </Link>
              <button
                disabled={busyId !== ''}
                onClick={() => analyzeExisting(quiz.id)}
                className="w-full rounded-lg border-2 border-blue-700 px-4 py-3 font-semibold text-blue-700 disabled:opacity-40"
              >
                {busyId === quiz.id ? 'Analiz edilir…' : 'AI analiz'}
              </button>
              {notes[quiz.id] && <p className="text-sm">{notes[quiz.id]}</p>}
            </section>
          )
        })}
    </main>
  )
}

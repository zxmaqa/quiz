import { useCallback, useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Link, useParams } from 'react-router-dom'
import NewQuiz from '../components/NewQuiz'
import { extract, solveAndStore, withoutCorrect, writeReasons } from '../lib/ai'
import type { Question } from '../lib/scoring'
import { supabase } from '../lib/supabase'

// Blind-test quiz (MIQ_2024-10-03): it must never be re-analysed from the UI.
const BLIND_QUIZ_ID = 'dba74e94-d631-4163-931d-dbc7bc857b82'

type Quiz = {
  id: string
  title: string
  status: string
  questions: { topic: string | null; misconceptions: unknown | null }[]
}

// Already analysed: every question has a topic and stored reasons (or it is the blind quiz).
const isAnalyzed = (quiz: Quiz) =>
  quiz.id === BLIND_QUIZ_ID ||
  (quiz.questions.length > 0 && quiz.questions.every((q) => q.topic && q.misconceptions))

export default function Teacher() {
  const { groupId = '' } = useParams()
  const [quizzes, setQuizzes] = useState<Quiz[] | null>(null)
  const [groupName, setGroupName] = useState('')
  const [failed, setFailed] = useState(false)
  const [creating, setCreating] = useState(false)
  const [photoMode, setPhotoMode] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [copiedId, setCopiedId] = useState('')
  const [notes, setNotes] = useState<Record<string, string>>({})

  const refresh = useCallback(() => {
    supabase
      .from('quizzes')
      .select('id,title,status,questions(topic,misconceptions)')
      .eq('group_id', groupId)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) setFailed(true)
        else setQuizzes(data as Quiz[])
      })
  }, [groupId])

  useEffect(refresh, [refresh])

  useEffect(() => {
    supabase
      .from('groups')
      .select('name')
      .eq('id', groupId)
      .maybeSingle()
      .then(({ data }) => setGroupName(data?.name ?? ''))
  }, [groupId])

  async function copyLink(quizId: string, link: string) {
    try {
      await navigator.clipboard.writeText(link)
      setCopiedId(quizId)
      setTimeout(() => setCopiedId(''), 1500)
    } catch {
      // clipboard unavailable: the full link is still the anchor's href
    }
  }

  // Fills topics and reasons only. Correct answers are never changed.
  async function analyzeExisting(quizId: string) {
    if (quizId === BLIND_QUIZ_ID) return
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
      // if the reasons call fails twice, topics and solutions are still saved and stored reasons stay as they are
      const reasons = await writeReasons(
        questions.map((q) => ({
          position: q.position,
          text: q.text,
          options: q.options,
          correct_label: q.correct_label,
        })),
        quizId,
        groupId,
      ).catch(() => null)
      const results = await Promise.all(
        questions.map((q) => {
          const topic = topics.questions.find((a) => a.position === q.position)?.topic
          const m = reasons?.[q.position]
          return supabase
            .from('questions')
            .update({
              ...(topic ? { topic } : {}),
              ...(reasons ? { misconceptions: m ? withoutCorrect(m, q.correct_label) : null } : {}),
            })
            .eq('id', q.id)
        }),
      )
      // verified worked solutions (solve mode)
      const solved = await solveAndStore(quizId, questions)
      note(
        results.some((r) => r.error) || !solved
          ? 'Yadda saxlamaq alınmadı.'
          : reasons
            ? 'AI analiz tamamlandı.'
            : 'AI bu dəfə səbəbləri yaratmadı, quiz saxlanıldı',
      )
    } catch {
      note('AI xətası. Bir az sonra yenidən cəhd edin.')
    }
    setBusyId('')
    refresh()
  }

  return (
    <main className="mx-auto max-w-[1024px] space-y-4 p-4">
      <h1 className="text-2xl font-bold">{groupName ? `${groupName} — Quizlər` : 'Quizlər'}</h1>
      {creating ? (
        <>
          <NewQuiz
            groupId={groupId}
            photo={photoMode}
            onSaved={() => {
              setCreating(false)
              refresh()
            }}
          />
          <button onClick={() => setCreating(false)} className="min-h-12 text-primary underline underline-offset-4">
            Ləğv et
          </button>
        </>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            onClick={() => {
              setPhotoMode(false)
              setCreating(true)
            }}
            className="btn btn-primary"
          >
            Yeni quiz
          </button>
          <button
            onClick={() => {
              setPhotoMode(true)
              setCreating(true)
            }}
            className="btn btn-secondary"
          >
            Şəkildən quiz
          </button>
        </div>
      )}
      {failed && (
        <p role="alert" className="rounded-input bg-warn-bg p-3 text-warn">
          Xəta baş verdi. Səhifəni yeniləyin.
        </p>
      )}
      {!failed && quizzes === null && <p className="text-muted">Yüklənir…</p>}
      {quizzes?.length === 0 && <p className="text-muted">Bu qrupda quiz yoxdur.</p>}
      <div className="grid gap-4 md:grid-cols-2">
        {!creating &&
          quizzes?.map((quiz) => {
            const link = `${window.location.origin}/q/${quiz.id}`
            return (
              <section key={quiz.id} className="card space-y-4">
                <div className="space-y-1">
                  <h2 className="text-lg font-semibold">{quiz.title}</h2>
                  <p className="text-sm text-muted">Status: {quiz.status === 'live' ? 'Aktiv' : 'Qaralama'}</p>
                </div>
                {quiz.status === 'live' && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-3 rounded-input border border-line bg-page px-3">
                      <a
                        href={link}
                        className="mono min-h-12 truncate py-3 text-sm text-primary underline underline-offset-4"
                      >
                        …/q/{quiz.id.slice(0, 8)}
                      </a>
                      <button
                        onClick={() => copyLink(quiz.id, link)}
                        className="btn btn-secondary min-h-12 px-4 text-sm"
                      >
                        {copiedId === quiz.id ? 'Kopyalandı' : 'Kopyala'}
                      </button>
                    </div>
                    <div className="flex justify-center">
                      <div className="rounded-input border border-line bg-white p-3">
                        <QRCodeSVG value={link} size={176} />
                      </div>
                    </div>
                  </div>
                )}
                <div className="flex flex-col gap-3 sm:flex-row">
                  <Link to={`/t/${groupId}/r/${quiz.id}`} className="btn btn-primary flex-1">
                    Nəticələr
                  </Link>
                  {isAnalyzed(quiz) ? (
                    <span className="btn flex-1 bg-line text-muted">Təhlil edilib</span>
                  ) : (
                    <button
                      disabled={busyId !== ''}
                      onClick={() => analyzeExisting(quiz.id)}
                      className="btn btn-secondary flex-1"
                    >
                      {busyId === quiz.id ? 'Analiz edilir…' : 'AI analiz'}
                    </button>
                  )}
                </div>
                {notes[quiz.id] && <p className="text-sm text-muted">{notes[quiz.id]}</p>}
              </section>
            )
          })}
      </div>
    </main>
  )
}

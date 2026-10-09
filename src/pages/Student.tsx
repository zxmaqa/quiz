import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import MissedItem from '../components/MissedItem'
import { topicName } from '../lib/topicNames'
import { analyzeStudent, score, weakTopics, type Answers, type Question } from '../lib/scoring'

type Quiz = { id: string; title: string; status: string }

type Saved = {
  name: string
  answers: Answers
  index: number
  submitted: boolean
  submissionId: string
}

const storageKey = (quizId: string) => `quiz:${quizId}`

function load(quizId: string): Saved {
  try {
    const raw = localStorage.getItem(storageKey(quizId))
    if (raw) return JSON.parse(raw) as Saved
  } catch {
    // ignore: fall back to a fresh state
  }
  return { name: '', answers: {}, index: 0, submitted: false, submissionId: crypto.randomUUID() }
}

export default function Student() {
  const { quizId = '' } = useParams()
  const [quiz, setQuiz] = useState<Quiz | null>(null)
  const [questions, setQuestions] = useState<Question[]>([])
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState<Saved>(() => load(quizId))
  const [nameInput, setNameInput] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState(false)

  useEffect(() => {
    try {
      localStorage.setItem(storageKey(quizId), JSON.stringify(saved))
    } catch {
      // ignore: storage unavailable
    }
  }, [quizId, saved])

  useEffect(() => {
    Promise.all([
      supabase.from('quizzes').select('id,title,status').eq('id', quizId).maybeSingle(),
      supabase.from('questions').select('*').eq('quiz_id', quizId).order('position'),
    ]).then(([q, qs]) => {
      if (!q.error && !qs.error && q.data) {
        setQuiz(q.data as Quiz)
        setQuestions(qs.data as Question[])
      }
      setLoading(false)
    })
  }, [quizId])

  async function submit() {
    setSending(true)
    setSendError(false)
    const answers: Answers = Object.fromEntries(
      questions.map((q) => [q.id, saved.answers[q.id] ?? null]),
    )
    const { error } = await supabase.from('submissions').insert({
      id: saved.submissionId,
      quiz_id: quizId,
      student_name: saved.name,
      answers,
    })
    setSending(false)
    // 23505 = already stored by an earlier attempt whose response was lost
    if (error && error.code !== '23505') {
      setSendError(true)
      return
    }
    setSaved((s) => ({ ...s, submitted: true }))
  }

  if (loading) return <main className="mx-auto max-w-[480px] p-4">Yüklənir…</main>
  if (!quiz || questions.length === 0) return <main className="mx-auto max-w-[480px] p-4">Quiz tapılmadı.</main>

  if (saved.submitted) return <Result quiz={quiz} questions={questions} answers={saved.answers} />

  if (quiz.status !== 'live') return <main className="mx-auto max-w-[480px] p-4">Bu quiz hazırda aktiv deyil.</main>

  if (!saved.name) {
    return (
      <main className="mx-auto max-w-[480px] p-4">
        <div className="card space-y-4">
          <h1 className="text-2xl font-bold">{quiz.title}</h1>
          <label className="block space-y-2">
            <span className="font-semibold">Adınız</span>
            <input
              value={nameInput}
              maxLength={30}
              onChange={(e) => setNameInput(e.target.value)}
              className="input text-lg"
            />
          </label>
          <button
            disabled={!nameInput.trim()}
            onClick={() => setSaved((s) => ({ ...s, name: nameInput.trim().slice(0, 30) }))}
            className="btn btn-primary w-full text-lg"
          >
            Başla
          </button>
        </div>
      </main>
    )
  }

  const q = questions[saved.index]
  const chosen = saved.answers[q.id]
  const isBlank = q.id in saved.answers && chosen === null
  const isLast = saved.index === questions.length - 1
  const choose = (label: string | null) =>
    setSaved((s) => ({ ...s, answers: { ...s.answers, [q.id]: label } }))
  const go = (index: number) => setSaved((s) => ({ ...s, index }))

  return (
    <main className="mx-auto max-w-[480px] space-y-4 p-4 pb-32">
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm text-muted">
          <span>Sual</span>
          <span className="mono text-base text-ink">
            {saved.index + 1} / {questions.length}
          </span>
        </div>
        <div
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={questions.length}
          aria-valuenow={saved.index + 1}
          className="h-2 overflow-hidden rounded-full bg-line"
        >
          <div
            className="h-2 rounded-full bg-primary transition-[width] duration-150"
            style={{ width: `${((saved.index + 1) / questions.length) * 100}%` }}
          />
        </div>
      </div>
      <section className="card">
        <h1 className="whitespace-pre-line text-xl font-bold">{q.text}</h1>
      </section>
      <div className="space-y-3">
        {q.options.map((o) => {
          const selected = chosen === o.label
          return (
            <button
              key={o.label}
              onClick={() => choose(o.label)}
              aria-pressed={selected}
              className={`flex min-h-14 w-full items-center gap-3 rounded-btn border-2 px-4 py-3 text-left text-lg transition-colors duration-150 ${
                selected ? 'border-primary bg-primary-soft' : 'border-line bg-card hover:border-primary'
              }`}
            >
              <span className={`letter ${selected ? 'border-primary bg-primary text-white' : ''}`}>{o.label}</span>
              <span>{o.text}</span>
            </button>
          )
        })}
        <button
          onClick={() => choose(null)}
          aria-pressed={isBlank}
          className={`mx-auto block min-h-12 rounded-btn px-4 text-primary underline underline-offset-4 ${
            isBlank ? 'bg-primary-soft font-semibold' : ''
          }`}
        >
          Bilmirəm, boş burax
        </button>
      </div>
      {sendError && (
        <p role="alert" className="rounded-input bg-warn-bg p-3 text-warn">
          Göndərmək alınmadı. Cavablarınız saxlanıldı, yenidən cəhd edin.
        </p>
      )}
      <div className="fixed inset-x-0 bottom-0 border-t border-line bg-card">
        <div className="mx-auto flex max-w-[480px] gap-3 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
          <button
            disabled={saved.index === 0}
            onClick={() => go(saved.index - 1)}
            className="btn btn-secondary flex-1"
          >
            Əvvəlki
          </button>
          {isLast ? (
            <button disabled={sending} onClick={submit} className="btn btn-primary flex-1">
              {sending ? 'Göndərilir…' : sendError ? 'Yenidən göndər' : 'Göndər'}
            </button>
          ) : (
            <button onClick={() => go(saved.index + 1)} className="btn btn-primary flex-1">
              Növbəti
            </button>
          )}
        </div>
      </div>
    </main>
  )
}


function Result({ quiz, questions, answers }: { quiz: Quiz; questions: Question[]; answers: Answers }) {
  const weak = weakTopics(questions, answers)
  const { missed, strong } = analyzeStudent(questions, answers)

  return (
    <main className="mx-auto max-w-[480px] space-y-4 p-4">
      <h1 className="text-xl font-bold">{quiz.title}</h1>
      <section className="card text-center">
        <p className="text-muted">Nəticə</p>
        <p className="mono text-5xl">
          {score(questions, answers)} / {questions.length}
        </p>
      </section>
      <section className="card space-y-3">
        <h2 className="font-semibold">Bu mövzular üzərində işlə</h2>
        {weak.length ? (
          <div className="flex flex-wrap gap-2">
            {weak.map((t) => (
              <span key={t} className="chip">
                {topicName(t)}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-muted">Zəif mövzu yoxdur.</p>
        )}
      </section>
      {missed.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-semibold">Səhv və ya boş cavablar</h2>
          {missed.map((m) => (
            <MissedItem key={m.q.id} item={m} answerLabel="Sizin cavab" showReason={false} />
          ))}
        </section>
      )}
      {missed.some((m) => m.misconception) && (
        <section className="card space-y-2">
          <h2 className="font-semibold">Ehtimal olunan səbəblər</h2>
          {strong.map((s) => (
            <p key={s.reason} className="text-sm font-semibold text-warn">
              Güclü siqnal: ehtimal, eyni səhv {s.count} dəfə təkrarlanıb: {s.reason}
            </p>
          ))}
          {missed
            .filter((m) => m.misconception)
            .map((m) => (
              <p key={m.q.id} className="text-sm text-muted">
                {m.q.position}. {m.misconception!.reason}
                {m.misconception!.calculation && <> (ehtimal olunan hesablama: {m.misconception!.calculation})</>}
              </p>
            ))}
        </section>
      )}
    </main>
  )
}
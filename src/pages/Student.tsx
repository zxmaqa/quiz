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

  if (loading) return <main className="p-4">Yüklənir…</main>
  if (!quiz || questions.length === 0) return <main className="p-4">Quiz tapılmadı.</main>

  if (saved.submitted) return <Result quiz={quiz} questions={questions} answers={saved.answers} />

  if (quiz.status !== 'live') return <main className="p-4">Bu quiz hazırda aktiv deyil.</main>

  if (!saved.name) {
    return (
      <main className="mx-auto max-w-xl space-y-4 p-4">
        <h1 className="text-2xl font-bold">{quiz.title}</h1>
        <label className="block space-y-2">
          <span className="font-medium">Adınız</span>
          <input
            value={nameInput}
            maxLength={30}
            onChange={(e) => setNameInput(e.target.value)}
            className="w-full rounded-xl border-2 border-gray-300 p-4 text-lg"
          />
        </label>
        <button
          disabled={!nameInput.trim()}
          onClick={() => setSaved((s) => ({ ...s, name: nameInput.trim().slice(0, 30) }))}
          className="w-full rounded-xl bg-blue-700 p-4 text-lg font-semibold text-white disabled:opacity-40"
        >
          Başla
        </button>
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
    <main className="mx-auto max-w-xl space-y-4 p-4">
      <p className="text-sm text-gray-600">
        Sual {saved.index + 1} / {questions.length}
      </p>
      <h1 className="whitespace-pre-line text-xl font-bold">{q.text}</h1>
      <div className="space-y-3">
        {q.options.map((o) => (
          <button
            key={o.label}
            onClick={() => choose(o.label)}
            className={`flex min-h-16 w-full items-center gap-3 rounded-xl border-2 p-4 text-left text-lg ${
              chosen === o.label ? 'border-blue-700 bg-blue-100' : 'border-gray-300'
            }`}
          >
            <span className="font-bold">{o.label}</span>
            <span>{o.text}</span>
          </button>
        ))}
        <button
          onClick={() => choose(null)}
          className={`w-full rounded-xl border-2 p-3 ${
            isBlank ? 'border-blue-700 bg-blue-100' : 'border-gray-300'
          }`}
        >
          Bilmirəm, boş burax
        </button>
      </div>
      {sendError && (
        <p className="text-red-600">Göndərmək alınmadı. Cavablarınız saxlanıldı, yenidən cəhd edin.</p>
      )}
      <div className="flex gap-3">
        <button
          disabled={saved.index === 0}
          onClick={() => go(saved.index - 1)}
          className="flex-1 rounded-xl border-2 border-gray-300 p-4 font-semibold disabled:opacity-40"
        >
          Əvvəlki
        </button>
        {isLast ? (
          <button
            disabled={sending}
            onClick={submit}
            className="flex-1 rounded-xl bg-green-700 p-4 font-semibold text-white disabled:opacity-40"
          >
            {sending ? 'Göndərilir…' : sendError ? 'Yenidən göndər' : 'Göndər'}
          </button>
        ) : (
          <button
            onClick={() => go(saved.index + 1)}
            className="flex-1 rounded-xl bg-blue-700 p-4 font-semibold text-white"
          >
            Növbəti
          </button>
        )}
      </div>
    </main>
  )
}


function Result({ quiz, questions, answers }: { quiz: Quiz; questions: Question[]; answers: Answers }) {
  const weak = weakTopics(questions, answers)
  const { missed, strong } = analyzeStudent(questions, answers)

  return (
    <main className="mx-auto max-w-xl space-y-4 p-4">
      <h1 className="text-2xl font-bold">{quiz.title}</h1>
      <p className="text-3xl font-bold">
        Nəticə: {score(questions, answers)} / {questions.length}
      </p>
      <section>
        <h2 className="font-semibold">Bu mövzular üzərində işlə</h2>
        <p>{weak.length ? weak.map(topicName).join(', ') : 'Zəif mövzu yoxdur.'}</p>
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
        <section className="space-y-2">
          <h2 className="font-semibold">Ehtimal olunan səbəblər</h2>
          {strong.map((s) => (
            <p key={s.reason} className="text-sm">
              Güclü siqnal: ehtimal, eyni səhv {s.count} dəfə təkrarlanıb: {s.reason}
            </p>
          ))}
          {missed
            .filter((m) => m.misconception)
            .map((m) => (
              <p key={m.q.id} className="text-sm text-gray-700">
                {m.q.position}. {m.misconception!.reason}
                {m.misconception!.calculation && <> (ehtimal olunan hesablama: {m.misconception!.calculation})</>}
              </p>
            ))}
        </section>
      )}
    </main>
  )
}
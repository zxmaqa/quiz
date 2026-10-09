import { useState } from 'react'
import { analyze, withoutCorrect, type AiQuestion } from '../lib/ai'
import { supabase } from '../lib/supabase'
import { UNSURE } from '../lib/scoring'

type Draft = AiQuestion & { correct: string | null }

export default function NewQuiz({ groupId, onSaved }: { groupId: string; onSaved: () => void }) {
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [topics, setTopics] = useState<string[]>([])
  const [draft, setDraft] = useState<Draft[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function read() {
    setBusy(true)
    setError('')
    try {
      const res = await analyze(text)
      if (res.questions.length === 0) {
        setError('Mətndə sual tapılmadı.')
      } else {
        setTopics(res.topics)
        setDraft(res.questions.map((q) => ({ ...q, correct: null })))
      }
    } catch {
      setError('AI xətası. Bir az sonra yenidən cəhd edin.')
    }
    setBusy(false)
  }

  const update = (i: number, patch: Partial<Draft>) =>
    setDraft((d) => d && d.map((q, j) => (j === i ? { ...q, ...patch } : q)))

  async function save() {
    if (!draft) return
    setBusy(true)
    setError('')
    const { data: quiz, error: quizError } = await supabase
      .from('quizzes')
      .insert({ group_id: groupId, title: title.trim(), status: 'draft' })
      .select('id')
      .single()
    if (quizError || !quiz) {
      setError('Yadda saxlamaq alınmadı.')
      setBusy(false)
      return
    }
    const { error: qError } = await supabase.from('questions').insert(
      draft.map((q, i) => ({
        quiz_id: quiz.id,
        position: i + 1,
        text: q.text,
        topic: q.topic,
        options: q.options,
        correct_label: q.correct,
        misconceptions: withoutCorrect(q.misconceptions, q.correct!),
      })),
    )
    const { error: liveError } = qError
      ? { error: qError }
      : await supabase.from('quizzes').update({ status: 'live' }).eq('id', quiz.id)
    if (liveError) {
      await supabase.from('quizzes').delete().eq('id', quiz.id)
      setError('Yadda saxlamaq alınmadı.')
      setBusy(false)
      return
    }
    setBusy(false)
    onSaved()
  }

  if (!draft) {
    return (
      <section className="space-y-3 rounded-xl border border-gray-300 p-4">
        <label className="block space-y-1">
          <span className="font-medium">Quizin adı</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-xl border-2 border-gray-300 p-3"
          />
        </label>
        <label className="block space-y-1">
          <span className="font-medium">Quiz mətni</span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            className="w-full rounded-xl border-2 border-gray-300 p-3"
          />
        </label>
        {error && <p className="text-red-600">{error}</p>}
        <button
          disabled={busy || !title.trim() || !text.trim()}
          onClick={read}
          className="w-full rounded-xl bg-blue-700 p-3 font-semibold text-white disabled:opacity-40"
        >
          {busy ? 'Oxunur…' : 'AI ilə oxu'}
        </button>
      </section>
    )
  }

  const ready = draft.every((q) => q.correct)

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-sm text-gray-600">Hər sual üçün düzgün cavabı toxunaraq seçin.</p>
      {draft.map((q, i) => (
        <div key={i} className="space-y-2 rounded-xl border border-gray-300 p-3">
          <p className="font-medium">
            {i + 1}. {q.text}
          </p>
          <select
            value={q.topic}
            onChange={(e) => update(i, { topic: e.target.value })}
            className={`w-full rounded-lg border-2 p-2 ${
              q.topic === UNSURE ? 'border-amber-500 bg-amber-100' : 'border-gray-300'
            }`}
          >
            {[...topics, UNSURE].map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          {q.options.map((o) => {
            const m = q.correct === o.label ? undefined : q.misconceptions[o.label]
            return (
              <div key={o.label}>
                <button
                  onClick={() => update(i, { correct: o.label })}
                  className={`w-full rounded-lg border-2 p-3 text-left ${
                    q.correct === o.label ? 'border-green-700 bg-green-100' : 'border-gray-300'
                  }`}
                >
                  <span className="font-bold">{o.label}</span> {o.text}
                </button>
                {m && (
                  <p className="px-2 pt-1 text-sm text-gray-700">
                    {m.reason === 'unknown'
                      ? 'Səbəb məlum deyil'
                      : `Ehtimal olunan səbəb: ${m.reason}${
                          m.calculation ? ` (ehtimal olunan hesablama: ${m.calculation})` : ''
                        }`}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      ))}
      {error && <p className="text-red-600">{error}</p>}
      <button
        disabled={busy || !ready}
        onClick={save}
        className="w-full rounded-xl bg-green-700 p-4 font-semibold text-white disabled:opacity-40"
      >
        {busy ? 'Saxlanılır…' : 'Yadda saxla və paylaş'}
      </button>
    </section>
  )
}

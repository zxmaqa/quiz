import { useState } from 'react'
import { extract, solveAndStore, withoutCorrect, writeReasons, type Extracted } from '../lib/ai'
import { supabase } from '../lib/supabase'
import { UNSURE, type Misconception } from '../lib/scoring'
import { topicLabel } from '../lib/topicNames'

type Draft = Extracted & { correct: string | null; misconceptions: Record<string, Misconception> | null }

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
      const res = await extract(text, groupId)
      if (res.questions.length === 0) {
        setError('Mətndə sual tapılmadı.')
      } else {
        setTopics(res.topics)
        setDraft(res.questions.map((q) => ({ ...q, correct: null, misconceptions: null })))
      }
    } catch {
      setError('AI xətası. Bir az sonra yenidən cəhd edin.')
    }
    setBusy(false)
  }

  // Call 2: needs the correct option of every question. Failing here never blocks saving.
  async function writeAllReasons() {
    if (!draft) return
    setBusy(true)
    setError('')
    try {
      const reasons = await writeReasons(
        draft.map((q, i) => ({ position: i + 1, text: q.text, options: q.options, correct_label: q.correct! })),
        undefined,
        groupId,
      )
      setDraft((d) => d && d.map((q, i) => ({ ...q, misconceptions: reasons[i + 1] ?? null })))
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
    const { data: saved, error: qError } = await supabase.from('questions').insert(
      draft.map((q, i) => ({
        quiz_id: quiz.id,
        position: i + 1,
        text: q.text,
        topic: q.topic,
        options: q.options,
        correct_label: q.correct,
        misconceptions: q.misconceptions ? withoutCorrect(q.misconceptions, q.correct!) : null,
      })),
    ).select('id,position,text,options,correct_label')
    const { error: liveError } = qError
      ? { error: qError }
      : await supabase.from('quizzes').update({ status: 'live' }).eq('id', quiz.id)
    if (liveError) {
      await supabase.from('quizzes').delete().eq('id', quiz.id)
      setError('Yadda saxlamaq alınmadı.')
      setBusy(false)
      return
    }
    // verified solutions are written in the background once the correct answers are saved
    if (saved) void solveAndStore(quiz.id, saved)
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
          <p className="whitespace-pre-line font-medium">
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
                {topicLabel(t)}
              </option>
            ))}
          </select>
          {q.options.map((o) => {
            const m = q.correct === o.label ? undefined : q.misconceptions?.[o.label]
            const shown = m && m.reason !== 'unknown' && !m.unchecked ? m : null
            return (
              <div key={o.label}>
                <button
                  onClick={() => update(i, { correct: o.label, misconceptions: null })}
                  className={`w-full rounded-lg border-2 p-3 text-left ${
                    q.correct === o.label ? 'border-green-700 bg-green-100' : 'border-gray-300'
                  }`}
                >
                  <span className="font-bold">{o.label}</span> {o.text}
                </button>
                {shown && (
                  <p className="px-2 pt-1 text-sm text-gray-700">
                    {`Ehtimal olunan səbəb: ${shown.reason}${
                      shown.calculation ? ` (ehtimal olunan hesablama: ${shown.calculation})` : ''
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
        onClick={writeAllReasons}
        className="w-full rounded-xl border-2 border-blue-700 p-3 font-semibold text-blue-700 disabled:opacity-40"
      >
        {busy ? 'Gözləyin…' : 'Səbəbləri AI ilə yaz'}
      </button>
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

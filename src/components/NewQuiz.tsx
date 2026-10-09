import { useState } from 'react'
import { toJpegBase64 } from '../lib/image'
import { extract, solveAndStore, withoutCorrect, writeReasons, type Extracted } from '../lib/ai'
import { supabase } from '../lib/supabase'
import { UNSURE, type Misconception } from '../lib/scoring'
import { topicLabel } from '../lib/topicNames'

type Draft = Extracted & { correct: string | null; misconceptions: Record<string, Misconception> | null }

export default function NewQuiz({
  groupId,
  onSaved,
  photo = false,
}: {
  groupId: string
  onSaved: () => void
  photo?: boolean
}) {
  const [files, setFiles] = useState<File[]>([])
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [topics, setTopics] = useState<string[]>([])
  const [draft, setDraft] = useState<Draft[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')

  async function read() {
    setBusy(true)
    setError('')
    try {
      let res
      if (photo) {
        let images: string[]
        try {
          images = await Promise.all(files.map(toJpegBase64))
        } catch {
          setError('Şəkil oxunmadı. JPEG və ya PNG şəkil seçin.')
          setBusy(false)
          return
        }
        res = await extract('', groupId, images)
      } else {
        res = await extract(text, groupId)
      }
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
    setNote('')
    try {
      const reasons = await writeReasons(
        draft.map((q, i) => ({ position: i + 1, text: q.text, options: q.options, correct_label: q.correct! })),
        undefined,
        groupId,
      )
      setDraft((d) => d && d.map((q, i) => ({ ...q, misconceptions: reasons[i + 1] ?? null })))
    } catch {
      setNote('AI bu dəfə səbəbləri yaratmadı. Quizi yenə də saxlaya bilərsiniz.')
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
      <section className="card space-y-4">
        <label className="block space-y-1">
          <span className="font-semibold">Quizin adı</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="input"
          />
        </label>
        {photo ? (
          <label className="block space-y-1">
            <span className="font-semibold">Quiz şəkilləri</span>
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 6))}
              className="input py-3"
            />
            {files.length > 0 && <span className="text-sm text-muted">{files.length} şəkil seçildi</span>}
          </label>
        ) : (
          <label className="block space-y-1">
            <span className="font-semibold">Quiz mətni</span>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={10} className="input" />
          </label>
        )}
        {error && (
        <p role="alert" className="rounded-input bg-warn-bg p-3 text-warn">
          {error}
        </p>
      )}
        <button
          disabled={busy || !title.trim() || (photo ? files.length === 0 : !text.trim())}
          onClick={read}
          className="btn btn-primary w-full"
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
      <p className="text-sm text-muted">Hər sual üçün düzgün cavabı toxunaraq seçin.</p>
      {draft.map((q, i) => (
        <div key={i} className="card space-y-3">
          <p className="whitespace-pre-line font-semibold">
            {i + 1}. {q.text}
          </p>
          <select
            value={q.topic}
            onChange={(e) => update(i, { topic: e.target.value })}
            className={`input ${q.topic === UNSURE ? 'border-warn! bg-warn-bg! text-warn!' : ''}`}
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
                  aria-pressed={q.correct === o.label}
                  className={`flex min-h-12 w-full items-center gap-3 rounded-btn border-2 px-3 py-2 text-left transition-colors duration-150 ${
                    q.correct === o.label ? 'border-ok bg-ok-bg' : 'border-line bg-card hover:border-primary'
                  }`}
                >
                  <span className={`letter ${q.correct === o.label ? 'border-ok bg-ok text-white' : ''}`}>{o.label}</span>
                  <span>{o.text}</span>
                </button>
                {shown && (
                  <p className="px-2 pt-1 text-sm text-muted">
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
      {error && (
        <p role="alert" className="rounded-input bg-warn-bg p-3 text-warn">
          {error}
        </p>
      )}
      {note && <p className="rounded-input bg-primary-soft p-3 text-sm">{note}</p>}
      <button
        disabled={busy || !ready}
        onClick={writeAllReasons}
        className="btn btn-secondary w-full"
      >
        {busy ? 'Gözləyin…' : 'Səbəbləri AI ilə yaz'}
      </button>
      <button
        disabled={busy || !ready}
        onClick={save}
        className="btn btn-primary w-full"
      >
        {busy ? 'Saxlanılır…' : 'Yadda saxla və paylaş'}
      </button>
    </section>
  )
}

export type Option = { label: string; text: string }

// reason === 'unknown' means the AI found no clear reason for that option
export type Misconception = {
  reason: string
  calculation?: string | null
  confidence?: 'high' | 'medium' | 'low'
}

export type Question = {
  id: string
  position: number
  text: string
  topic: string
  options: Option[]
  correct_label: string
  misconceptions: Record<string, Misconception> | null
}

// question id -> chosen label, null = left blank
export type Answers = Record<string, string | null>

export type Status = 'correct' | 'wrong' | 'blank'

export const UNSURE = 'UNSURE'

export function status(q: Question, answers: Answers): Status {
  const a = answers[q.id]
  if (!a) return 'blank'
  return a === q.correct_label ? 'correct' : 'wrong'
}

export function score(questions: Question[], answers: Answers): number {
  return questions.filter((q) => status(q, answers) === 'correct').length
}

// Weak topic: at least 2 questions on the topic and accuracy below 60% (blank counts as not correct).
// UNSURE questions have no real topic and are skipped.
export function weakTopics(questions: Question[], answers: Answers): string[] {
  const byTopic = new Map<string, { total: number; correct: number }>()
  for (const q of questions) {
    if (!q.topic || q.topic === UNSURE) continue
    const t = byTopic.get(q.topic) ?? { total: 0, correct: 0 }
    t.total += 1
    if (status(q, answers) === 'correct') t.correct += 1
    byTopic.set(q.topic, t)
  }
  return [...byTopic]
    .filter(([, t]) => t.total >= 2 && t.correct / t.total < 0.6)
    .map(([topic]) => topic)
}

export type Missed = {
  q: Question
  chosen: string | null
  misconception: Misconception | null // null when no option chosen or reason unknown
  ranOut: boolean // blank inside the trailing run of blanks
}

export type StrongSignal = { reason: string; count: number }

const normalize = (s: string) =>
  s.toLocaleLowerCase('az').replace(/[\s.,;:!?]+/g, ' ').trim()

// Code rules (no AI):
// - 2+ blanks in a row at the end of the quiz -> "vaxt çatmayıb"
// - the same reason for 2+ wrong answers of one student -> "güclü siqnal"
export function analyzeStudent(questions: Question[], answers: Answers) {
  let trailing = 0
  for (let i = questions.length - 1; i >= 0 && status(questions[i], answers) === 'blank'; i--) trailing++
  const timeRanOut = trailing >= 2

  const missed: Missed[] = []
  questions.forEach((q, i) => {
    if (status(q, answers) === 'correct') return
    const chosen = answers[q.id] || null
    const m = chosen ? (q.misconceptions?.[chosen] ?? null) : null
    missed.push({
      q,
      chosen,
      misconception: m && m.reason && m.reason !== 'unknown' ? m : null,
      ranOut: timeRanOut && !chosen && i >= questions.length - trailing,
    })
  })

  const counts = new Map<string, StrongSignal>()
  for (const { misconception } of missed) {
    if (!misconception) continue
    const key = normalize(misconception.reason)
    const entry = counts.get(key) ?? { reason: misconception.reason, count: 0 }
    entry.count += 1
    counts.set(key, entry)
  }
  const strong = [...counts.values()].filter((s) => s.count >= 2)

  return { missed, timeRanOut, strong }
}

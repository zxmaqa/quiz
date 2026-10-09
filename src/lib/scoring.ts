export type Option = { label: string; text: string }

export type Question = {
  id: string
  position: number
  text: string
  topic: string
  options: Option[]
  correct_label: string
  misconceptions: Record<string, string> | null
}

// question id -> chosen label, null = left blank
export type Answers = Record<string, string | null>

export type Status = 'correct' | 'wrong' | 'blank'

export function status(q: Question, answers: Answers): Status {
  const a = answers[q.id]
  if (!a) return 'blank'
  return a === q.correct_label ? 'correct' : 'wrong'
}

export function score(questions: Question[], answers: Answers): number {
  return questions.filter((q) => status(q, answers) === 'correct').length
}

// Weak topic: at least 2 questions on the topic and accuracy below 60% (blank counts as not correct).
export function weakTopics(questions: Question[], answers: Answers): string[] {
  const byTopic = new Map<string, { total: number; correct: number }>()
  for (const q of questions) {
    const t = byTopic.get(q.topic) ?? { total: 0, correct: 0 }
    t.total += 1
    if (status(q, answers) === 'correct') t.correct += 1
    byTopic.set(q.topic, t)
  }
  return [...byTopic]
    .filter(([, t]) => t.total >= 2 && t.correct / t.total < 0.6)
    .map(([topic]) => topic)
}

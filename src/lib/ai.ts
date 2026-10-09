import { supabase } from './supabase'
import type { Misconception, Option } from './scoring'

export type AiQuestion = {
  position: number
  text: string
  options: Option[]
  topic: string
  misconceptions: Record<string, Misconception>
}

export type Analysis = { questions: AiQuestion[]; topics: string[] }

// Only the quiz text is sent. Never student data.
export async function analyze(text: string, quizId?: string): Promise<Analysis> {
  const { data, error } = await supabase.functions.invoke('analyze-quiz', {
    body: { text, quiz_id: quizId },
  })
  if (error || !Array.isArray(data?.questions)) throw new Error('analyze failed')
  return data as Analysis
}

// The correct option is not a misconception, so it never keeps an entry.
export function withoutCorrect(m: Record<string, Misconception>, correct: string) {
  const rest = Object.fromEntries(Object.entries(m).filter(([label]) => label !== correct))
  return Object.keys(rest).length ? rest : null
}

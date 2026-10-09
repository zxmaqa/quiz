import { supabase } from './supabase'
import type { Misconception, Option } from './scoring'

export type Extracted = { position: number; text: string; options: Option[]; topic: string }

export type ReasonInput = { position: number; text: string; options: Option[]; correct_label: string }

// deno-lint-ignore no-explicit-any
async function call(body: Record<string, unknown>): Promise<any> {
  const { data, error } = await supabase.functions.invoke('analyze-quiz', { body })
  if (error || !Array.isArray(data?.questions)) throw new Error('analyze failed')
  return data
}

// Call 1: questions, options and topics only. Only the quiz text is sent, never student data.
export async function extract(text: string, groupId?: string): Promise<{ questions: Extracted[]; topics: string[] }> {
  return call({ step: 'extract', text, group_id: groupId })
}

// Call 2: reasons for the wrong options. Receives the correct label of every question and
// never returns an entry for the correct option. Result is keyed by question position.
export async function writeReasons(
  questions: ReasonInput[],
  quizId?: string,
  groupId?: string,
): Promise<Record<number, Record<string, Misconception>>> {
  const data = await call({ step: 'reasons', questions, quiz_id: quizId, group_id: groupId })
  return Object.fromEntries(
    data.questions.map((q: { position: number; misconceptions: Record<string, Misconception> }) => [
      q.position,
      q.misconceptions,
    ]),
  )
}

// The correct option is not a misconception, so it never keeps an entry.
export function withoutCorrect(m: Record<string, Misconception>, correct: string) {
  const rest = Object.fromEntries(Object.entries(m).filter(([label]) => label !== correct))
  return Object.keys(rest).length ? rest : null
}

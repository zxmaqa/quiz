import { createClient } from 'npm:@supabase/supabase-js@2'
import { buildPrompt, PROMPT_VERSION } from './prompt.ts'
import { TOPICS } from './topics.ts'

const DEFAULT_MODEL = 'gemini-3.8-flash'
const FALLBACK_MODEL = 'gemini-3.5-flash-lite'
const RETRY_STATUS = [429, 500, 503]
const MAX_TEXT = 20000

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type CallResult = { ok: true; data: unknown } | { ok: false; status: number; error: string }

// One Gemini call. Every call (success or failure) is logged to ai_calls.
async function callGemini(model: string, prompt: string, quizId: string | null): Promise<CallResult> {
  const started = Date.now()
  let result: CallResult
  // deno-lint-ignore no-explicit-any
  let usage: any = {}
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': Deno.env.get('GEMINI_API_KEY')! },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0 },
      }),
    })
    const body = await res.json().catch(() => null)
    usage = body?.usageMetadata ?? {}
    if (!res.ok) {
      result = { ok: false, status: res.status, error: body?.error?.message ?? `HTTP ${res.status}` }
    } else {
      // deno-lint-ignore no-explicit-any
      const raw = (body?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? '').join('')
      try {
        const parsed = JSON.parse(raw)
        const data = Array.isArray(parsed) ? { questions: parsed } : parsed
        result = Array.isArray(data?.questions)
          ? { ok: true, data }
          : { ok: false, status: 502, error: `Unexpected shape: ${raw.slice(0, 300)}` }
      } catch {
        result = { ok: false, status: 502, error: `Invalid JSON: ${raw.slice(0, 300)}` }
      }
    }
  } catch (e) {
    result = { ok: false, status: 0, error: String(e) }
  }
  await db.from('ai_calls').insert({
    quiz_id: quizId,
    kind: 'analyze-quiz',
    model,
    input_tokens: usage.promptTokenCount ?? null,
    // thinking tokens are billed as output
    output_tokens: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0) || null,
    ms: Date.now() - started,
    ok: result.ok,
    error: result.ok ? null : result.error.slice(0, 500),
  })
  return result
}

const compact = (s: string) => s.replace(/\s+/g, '').replace(',', '.').toLowerCase()

// A calculation is only believable if it ends exactly on the option's value.
const landsOn = (calculation: string, optionText: string) =>
  compact(calculation.split('=').pop() ?? '') === compact(optionText)

// The starting expression (before the first "=") may only use numbers from the question, plus 100 for percents.
const numbers = (s: string) => s.match(/\d+(?:[.,]\d+)?/g)?.map((n) => n.replace(',', '.')) ?? []
const usesQuestionNumbers = (calculation: string, questionText: string) => {
  const allowed = new Set([...numbers(questionText), '100'])
  return numbers(calculation.split('=')[0]).every((n) => allowed.has(n))
}

// deno-lint-ignore no-explicit-any
function cleanMisconceptions(raw: any, options: { label: string; text: string }[], questionText: string) {
  const out: Record<string, { reason: string; calculation?: string | null; confidence?: string }> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [label, m] of Object.entries(raw)) {
    if (!/^[A-Za-z]$/.test(label) || !m || typeof m !== 'object') continue
    // deno-lint-ignore no-explicit-any
    const { reason, calculation, confidence } = m as any
    const option = options.find((o) => o.label === label.toUpperCase())
    const hasCalc = typeof calculation === 'string' && calculation.trim()
    if (
      typeof reason !== 'string' ||
      !reason.trim() ||
      reason.trim().toLowerCase() === 'unknown' ||
      (hasCalc && option && !landsOn(calculation, option.text)) ||
      (hasCalc && !usesQuestionNumbers(calculation, questionText))
    ) {
      out[label.toUpperCase()] = { reason: 'unknown' }
      continue
    }
    out[label.toUpperCase()] = {
      reason: reason.trim(),
      calculation: typeof calculation === 'string' && calculation.trim() ? calculation.trim() : null,
      ...(['high', 'medium', 'low'].includes(confidence) ? { confidence } : {}),
    }
  }
  return out
}

// deno-lint-ignore no-explicit-any
function cleanQuestions(data: any) {
  if (!Array.isArray(data?.questions)) return null
  // deno-lint-ignore no-explicit-any
  return data.questions.map((q: any, i: number) => {
    // deno-lint-ignore no-explicit-any
    const options = (Array.isArray(q?.options) ? q.options : []).map((o: any) => ({
      label: String(o?.label ?? '').toUpperCase(),
      text: String(o?.text ?? ''),
    }))
    const text = String(q?.text ?? '')
    return {
      position: Number.isInteger(q?.position) ? q.position : i + 1,
      text,
      options,
      topic: TOPICS.includes(q?.topic) ? q.topic : 'UNSURE',
      misconceptions: cleanMisconceptions(q?.misconceptions, options, text),
    }
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let input
  try {
    input = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }
  const { quiz_id, text, model } = input ?? {}
  if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT) {
    return json({ error: `text is required (max ${MAX_TEXT} characters)` }, 400)
  }
  if (model != null && !/^[A-Za-z0-9._-]+$/.test(model)) return json({ error: 'Invalid model' }, 400)
  if (quiz_id != null && !/^[0-9a-f-]{36}$/i.test(quiz_id)) return json({ error: 'Invalid quiz_id' }, 400)

  const quizId: string | null = quiz_id ?? null
  const primary: string = model ?? Deno.env.get('MODEL') ?? DEFAULT_MODEL
  const prompt = buildPrompt(text, TOPICS)

  let used = primary
  let result = await callGemini(primary, prompt, quizId)
  if (!result.ok && RETRY_STATUS.includes(result.status)) {
    await sleep(2000)
    result = await callGemini(primary, prompt, quizId)
    if (!result.ok) {
      used = FALLBACK_MODEL
      result = await callGemini(FALLBACK_MODEL, prompt, quizId)
    }
  }
  if (!result.ok) return json({ error: result.error }, 502)

  const questions = cleanQuestions(result.data)
  if (!questions) return json({ error: 'Model returned an unexpected shape' }, 502)
  return json({ questions, topics: TOPICS, model: used, prompt_version: PROMPT_VERSION })
})

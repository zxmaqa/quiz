import { createClient } from 'npm:@supabase/supabase-js@2'
import { buildExtractPrompt, buildReasonsPrompt, PROMPT_VERSION, type QuizQuestion } from './prompt.ts'
import { TOPICS } from './topics.ts'

const DEFAULT_MODEL = 'claude-haiku-4-5'
const FALLBACK_MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash-lite']
const RETRY_STATUS = [429, 500, 503, 529]
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

// Claude may wrap JSON in a code fence or add a sentence around it.
const extractJson = (raw: string) => {
  const from = raw.indexOf('{')
  const to = raw.lastIndexOf('}')
  const fromArr = raw.indexOf('[')
  const toArr = raw.lastIndexOf(']')
  return from !== -1 && (fromArr === -1 || from < fromArr) ? raw.slice(from, to + 1) : raw.slice(fromArr, toArr + 1)
}

function parseModelJson(raw: string): CallResult {
  try {
    const parsed = JSON.parse(extractJson(raw))
    const data = Array.isArray(parsed) ? { questions: parsed } : parsed
    return Array.isArray(data?.questions)
      ? { ok: true, data }
      : { ok: false, status: 502, error: `Unexpected shape: ${raw.slice(0, 300)}` }
  } catch {
    return { ok: false, status: 502, error: `Invalid JSON: ${raw.slice(0, 300)}` }
  }
}

// One model call (Claude or Gemini, chosen by model name). Every call is logged to ai_calls.
async function callModel(
  model: string,
  prompt: string,
  kind: string,
  quizId: string | null,
): Promise<{ result: CallResult; logId: string }> {
  const started = Date.now()
  const logId = crypto.randomUUID()
  let result: CallResult
  let inputTokens: number | null = null
  let outputTokens: number | null = null
  try {
    if (model.startsWith('claude-')) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 8192,
          temperature: 0,
          messages: [{ role: 'user', content: prompt }],
        }),
      })
      const body = await res.json().catch(() => null)
      inputTokens = body?.usage?.input_tokens ?? null
      outputTokens = body?.usage?.output_tokens ?? null
      if (!res.ok) {
        result = { ok: false, status: res.status, error: body?.error?.message ?? `HTTP ${res.status}` }
      } else {
        // deno-lint-ignore no-explicit-any
        const raw = (body?.content ?? []).map((c: any) => c.text ?? '').join('')
        result = parseModelJson(raw)
      }
    } else {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': Deno.env.get('GEMINI_API_KEY')! },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0 },
        }),
      })
      const body = await res.json().catch(() => null)
      const usage = body?.usageMetadata ?? {}
      inputTokens = usage.promptTokenCount ?? null
      // thinking tokens are billed as output
      outputTokens = (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0) || null
      if (!res.ok) {
        result = { ok: false, status: res.status, error: body?.error?.message ?? `HTTP ${res.status}` }
      } else {
        // deno-lint-ignore no-explicit-any
        const raw = (body?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? '').join('')
        result = parseModelJson(raw)
      }
    }
  } catch (e) {
    result = { ok: false, status: 0, error: String(e) }
  }
  await db.from('ai_calls').insert({
    id: logId,
    quiz_id: quizId,
    kind,
    model,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    ms: Date.now() - started,
    ok: result.ok,
    error: result.ok ? null : result.error.slice(0, 500),
  })
  return { result, logId }
}

// ---- exact arithmetic (no eval) -------------------------------------------------------------

type Rat = { n: bigint; d: bigint }

const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? a : gcd(b, a % b))

function rat(n: bigint, d: bigint): Rat | null {
  if (d === 0n) return null
  if (d < 0n) {
    n = -n
    d = -d
  }
  const g = gcd(n < 0n ? -n : n, d)
  return g > 1n ? { n: n / g, d: d / g } : { n, d }
}

const eq = (a: Rat, b: Rat) => a.n * b.d === b.n * a.d
const fmt = (r: Rat) => (r.d === 1n ? `${r.n}` : `${r.n}/${r.d}`)

// Numbers, + - * / and parentheses only. Returns null for anything else or division by zero.
function evaluate(src: string): Rat | null {
  const s = src.replace(/[−–]/g, '-').replace(/[×·⋅]/g, '*').replace(/÷/g, '/')
  const tokens = s.match(/\d+(?:[.,]\d+)?|[()+\-*/]|\S/g) ?? []
  if (!tokens.length || tokens.length > 100) return null
  let i = 0

  const num = (t: string): Rat | null => {
    const [a, b = ''] = t.replace(',', '.').split('.')
    if (a.length + b.length > 15) return null
    return rat(BigInt(a + b), 10n ** BigInt(b.length))
  }
  const primary = (): Rat | null => {
    const t = tokens[i++]
    if (t === undefined) return null
    if (t === '(') {
      const v = expr()
      return v && tokens[i++] === ')' ? v : null
    }
    return /^\d/.test(t) ? num(t) : null
  }
  const unary = (): Rat | null => {
    if (tokens[i] === '-') {
      i++
      const v = unary()
      return v && { n: -v.n, d: v.d }
    }
    if (tokens[i] === '+') {
      i++
      return unary()
    }
    return primary()
  }
  const term = (): Rat | null => {
    let l = unary()
    while (l && (tokens[i] === '*' || tokens[i] === '/')) {
      const op = tokens[i++]
      const r = unary()
      if (!r) return null
      l = op === '*' ? rat(l.n * r.n, l.d * r.d) : rat(l.n * r.d, l.d * r.n)
    }
    return l
  }
  const expr = (): Rat | null => {
    let l = term()
    while (l && (tokens[i] === '+' || tokens[i] === '-')) {
      const op = tokens[i++]
      const r = term()
      if (!r) return null
      l = rat(op === '+' ? l.n * r.d + r.n * l.d : l.n * r.d - r.n * l.d, l.d * r.d)
    }
    return l
  }

  const v = expr()
  return v && i === tokens.length ? v : null
}

// The option's own value: "4/12", "1.6", "20%", "60 manat".
function optionValue(text: string): Rat | null {
  const t = text.trim().replace(/%/g, '/100')
  return evaluate(t) ?? evaluate(t.replace(/\s*[\p{L}.]+$/u, ''))
}

// The starting expression (before the first "=") may only use numbers from the question, plus 100 for percents.
const numbers = (s: string) => s.match(/\d+(?:[.,]\d+)?/g)?.map((n) => n.replace(',', '.')) ?? []
const usesQuestionNumbers = (firstStep: string, questionText: string) => {
  const allowed = new Set([...numbers(questionText), '100'])
  return numbers(firstStep).every((n) => allowed.has(n))
}

// null = calculation accepted, otherwise the failure code.
function checkCalculation(calculation: unknown, questionText: string, optionText: string): string | null {
  if (typeof calculation !== 'string' || !calculation.trim()) return 'no_calculation'
  if (calculation.includes('%')) return 'percent_sign'
  const steps = calculation.split('=').map((s) => s.trim())
  if (steps.some((s) => !s)) return 'empty_step'
  const values = steps.map(evaluate)
  if (values.some((v) => v === null)) return 'not_arithmetic'
  const vs = values as Rat[]
  if (!vs.every((v) => eq(v, vs[0]))) return `steps_not_equal (${vs.map(fmt).join(' vs ')})`
  const option = optionValue(optionText)
  if (!option) return 'option_not_numeric'
  const last = vs[vs.length - 1]
  if (!eq(last, option)) return `final_value_mismatch (${fmt(last)} vs option ${fmt(option)})`
  if (!usesQuestionNumbers(steps[0], questionText)) return 'numbers_not_in_question'
  return null
}

// ---- cleaning ---------------------------------------------------------------------------------

// deno-lint-ignore no-explicit-any
function cleanExtracted(data: any) {
  // deno-lint-ignore no-explicit-any
  return data.questions.map((q: any, i: number) => ({
    position: Number.isInteger(q?.position) ? q.position : i + 1,
    text: String(q?.text ?? ''),
    // deno-lint-ignore no-explicit-any
    options: (Array.isArray(q?.options) ? q.options : []).map((o: any) => ({
      label: String(o?.label ?? '').toUpperCase(),
      text: String(o?.text ?? ''),
    })),
    topic: TOPICS.includes(q?.topic) ? q.topic : 'UNSURE',
  }))
}

type Misconception = { reason: string; calculation?: string; confidence?: string }

// Every wrong option gets either a checked reason or { reason: "unknown" } plus a recorded cause.
// The correct option never gets an entry.
// deno-lint-ignore no-explicit-any
function cleanReasons(data: any, questions: QuizQuestion[]) {
  const unknown: Record<string, Record<string, string>> = {}
  const droppedCorrect: string[] = []
  const out = questions.map((q) => {
    // deno-lint-ignore no-explicit-any
    const entry = data.questions.find((x: any) => x?.position === q.position)
    const raw = entry?.misconceptions && typeof entry.misconceptions === 'object' ? entry.misconceptions : {}
    const misconceptions: Record<string, Misconception> = {}
    for (const o of q.options) {
      const m = raw[o.label]
      const reason = typeof m?.reason === 'string' ? m.reason.trim() : ''
      const gaveReason = reason !== '' && reason.toLowerCase() !== 'unknown'
      if (o.label === q.correct_label) {
        if (gaveReason) droppedCorrect.push(`${q.position}${o.label}`)
        continue
      }
      const markUnknown = (cause: string) => {
        misconceptions[o.label] = { reason: 'unknown' }
        ;(unknown[q.position] ??= {})[o.label] = cause
      }
      if (!gaveReason) {
        markUnknown('model_unknown')
        continue
      }
      const failure = checkCalculation(m.calculation, q.text, o.text)
      if (failure) {
        markUnknown(`check_failed: ${failure}`)
        continue
      }
      misconceptions[o.label] = {
        reason,
        calculation: m.calculation.trim(),
        ...(['high', 'medium', 'low'].includes(m.confidence) ? { confidence: m.confidence } : {}),
      }
    }
    return { position: q.position, misconceptions }
  })
  return { questions: out, unknown, droppedCorrect }
}

// deno-lint-ignore no-explicit-any
function parseQuestions(raw: any): QuizQuestion[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 50) return null
  const out: QuizQuestion[] = []
  for (const q of raw) {
    if (!Number.isInteger(q?.position) || typeof q?.text !== 'string') return null
    if (!/^[A-Z]$/.test(q?.correct_label ?? '')) return null
    if (!Array.isArray(q?.options) || q.options.length < 2 || q.options.length > 10) return null
    // deno-lint-ignore no-explicit-any
    if (q.options.some((o: any) => !/^[A-Z]$/.test(o?.label ?? '') || typeof o?.text !== 'string')) return null
    out.push({ position: q.position, text: q.text, options: q.options, correct_label: q.correct_label })
  }
  return JSON.stringify(out).length > MAX_TEXT ? null : out
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
  const { quiz_id, text, model, step } = input ?? {}
  if (step !== 'extract' && step !== 'reasons') return json({ error: 'step must be "extract" or "reasons"' }, 400)
  if (model != null && !/^[A-Za-z0-9._-]+$/.test(model)) return json({ error: 'Invalid model' }, 400)
  if (quiz_id != null && !/^[0-9a-f-]{36}$/i.test(quiz_id)) return json({ error: 'Invalid quiz_id' }, 400)

  let prompt: string
  let questions: QuizQuestion[] | null = null
  if (step === 'extract') {
    if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT) {
      return json({ error: `text is required (max ${MAX_TEXT} characters)` }, 400)
    }
    prompt = buildExtractPrompt(text, TOPICS)
  } else {
    questions = parseQuestions(input.questions)
    if (!questions) return json({ error: 'questions with position, text, options and correct_label are required' }, 400)
    prompt = buildReasonsPrompt(questions, TOPICS)
  }

  const quizId: string | null = quiz_id ?? null
  const primary: string = model ?? Deno.env.get('MODEL') ?? DEFAULT_MODEL

  let used = primary
  let { result, logId } = await callModel(primary, prompt, step, quizId)
  if (!result.ok && RETRY_STATUS.includes(result.status)) {
    await sleep(2000)
    ;({ result, logId } = await callModel(primary, prompt, step, quizId))
    for (const fallback of FALLBACK_MODELS.filter((m) => m !== primary)) {
      if (result.ok) break
      used = fallback
      ;({ result, logId } = await callModel(fallback, prompt, step, quizId))
    }
  }
  if (!result.ok) return json({ error: result.error }, 502)

  if (step === 'extract') {
    return json({ step, questions: cleanExtracted(result.data), topics: TOPICS, model: used, prompt_version: PROMPT_VERSION })
  }

  const cleaned = cleanReasons(result.data, questions!)
  await db
    .from('ai_calls')
    .update({
      details: {
        step,
        prompt_version: PROMPT_VERSION,
        unknown: cleaned.unknown,
        correct_option_reasons_dropped: cleaned.droppedCorrect,
      },
    })
    .eq('id', logId)
  return json({
    step,
    questions: cleaned.questions,
    unknown_reasons: cleaned.unknown,
    model: used,
    prompt_version: PROMPT_VERSION,
  })
})

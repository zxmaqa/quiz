import { createClient } from 'npm:@supabase/supabase-js@2'
import { buildExtractPrompt, buildReasonsPrompt, PROMPT_VERSION, type QuizQuestion } from './prompt.ts'
import { TOPICS } from './topics.ts'
import {
  buildKimyaExtractPrompt,
  buildKimyaReasonsPrompt,
  PROMPT_VERSION as KIMYA_PROMPT_VERSION,
} from './prompt_kimya.ts'
import { KIMYA_TOPICS } from './topics_kimya.ts'
import { ATOMIC_MASSES, SOLUTION_CONSTANTS } from './atomic_masses.ts'
import {
  buildSolvePrompt,
  buildSummaryPrompt,
  PROMPT_VERSION as SOLVE_PROMPT_VERSION,
  SUMMARY_PROMPT_VERSION,
  type TopicStat,
} from './prompt_solve.ts'

const DEFAULT_MODEL = 'claude-haiku-4-5'
const SOLVE_MODEL = 'claude-sonnet-4-6'
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

function parseModelJson(raw: string, shapeKey = 'questions'): CallResult {
  try {
    const parsed = JSON.parse(extractJson(raw))
    const data = Array.isArray(parsed) ? { [shapeKey]: parsed } : parsed
    return Array.isArray(data?.[shapeKey])
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
  shapeKey = 'questions',
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
        result = parseModelJson(raw, shapeKey)
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
        result = parseModelJson(raw, shapeKey)
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

type Misconception = { reason: string; calculation?: string; confidence?: string; unchecked?: boolean }

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

// ---- chemistry (separate from the math path above) ----------------------------------------------

const KIMYA_IDS = KIMYA_TOPICS.map((t) => t.id)

// Topic must be one of K01..K33 or UNSURE. Anything else becomes UNSURE and is reported for ai_calls.
// deno-lint-ignore no-explicit-any
function cleanExtractedKimya(data: any) {
  const invalidTopics: { position: number; returned: string }[] = []
  // deno-lint-ignore no-explicit-any
  const questions = data.questions.map((q: any, i: number) => {
    const position = Number.isInteger(q?.position) ? q.position : i + 1
    const returned = typeof q?.topic === 'string' ? q.topic.trim() : ''
    const topic = KIMYA_IDS.includes(returned.toUpperCase()) ? returned.toUpperCase() : 'UNSURE'
    if (topic === 'UNSURE' && returned.toUpperCase() !== 'UNSURE') invalidTopics.push({ position, returned })
    return {
      position,
      text: String(q?.text ?? ''),
      // deno-lint-ignore no-explicit-any
      options: (Array.isArray(q?.options) ? q.options : []).map((o: any) => ({
        label: String(o?.label ?? '').toUpperCase(),
        text: String(o?.text ?? ''),
      })),
      topic,
    }
  })
  return { questions, invalidTopics }
}

type OptionRecord = {
  ai_reason: string
  ai_calculation: string
  check_applicable: boolean
  check_passed: boolean | null
  unknown_reason: string
}

// Calculation questions (every option is a plain number): the reason must pass the arithmetic check,
// otherwise it becomes unknown. Concept questions: no check; the reason is kept only when the model
// said "high", and it is marked unchecked.
// deno-lint-ignore no-explicit-any
function cleanReasonsKimya(data: any, questions: QuizQuestion[]) {
  const unknown: Record<string, Record<string, string>> = {}
  const perOption: Record<string, Record<string, OptionRecord>> = {}
  const droppedCorrect: string[] = []
  const out = questions.map((q) => {
    // deno-lint-ignore no-explicit-any
    const entry = data.questions.find((x: any) => x?.position === q.position)
    const raw = entry?.misconceptions && typeof entry.misconceptions === 'object' ? entry.misconceptions : {}
    const checkApplicable = q.options.every((o) => optionValue(o.text) !== null)
    const misconceptions: Record<string, Misconception> = {}
    for (const o of q.options) {
      const m = raw[o.label]
      const reason = typeof m?.reason === 'string' ? m.reason.trim() : ''
      const gaveReason = reason !== '' && reason.toLowerCase() !== 'unknown'
      if (o.label === q.correct_label) {
        if (gaveReason) droppedCorrect.push(`${q.position}${o.label}`)
        continue
      }
      const record: OptionRecord = {
        ai_reason: gaveReason ? reason : '',
        ai_calculation: typeof m?.calculation === 'string' ? m.calculation : '',
        check_applicable: checkApplicable,
        check_passed: null,
        unknown_reason: '',
      }
      ;(perOption[q.position] ??= {})[o.label] = record
      const markUnknown = (cause: string) => {
        misconceptions[o.label] = { reason: 'unknown' }
        record.unknown_reason = cause
        ;(unknown[q.position] ??= {})[o.label] = cause
      }
      if (!gaveReason) {
        markUnknown('model_unknown')
        continue
      }
      if (checkApplicable) {
        const failure = checkCalculation(m.calculation, q.text, o.text)
        record.check_passed = failure === null
        if (failure) {
          markUnknown(`check_failed: ${failure}`)
          continue
        }
        misconceptions[o.label] = {
          reason,
          calculation: m.calculation.trim(),
          ...(['high', 'medium', 'low'].includes(m.confidence) ? { confidence: m.confidence } : {}),
        }
      } else if (m.confidence === 'high') {
        misconceptions[o.label] = { reason, confidence: 'high', unchecked: true }
      } else {
        markUnknown('unchecked_not_high_confidence')
      }
    }
    return { position: q.position, misconceptions }
  })
  return { questions: out, unknown, perOption, droppedCorrect }
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

// ---- solve / class-summary (new modes; the extract/reasons paths above are unchanged) ------------------

const ratKey = (r: Rat) => `${r.n}/${r.d}`

// Same retry and fallbacks as the other modes.
async function runChain(primary: string, prompt: string, kind: string, quizId: string | null, shapeKey: string) {
  let used = primary
  let { result, logId } = await callModel(primary, prompt, kind, quizId, shapeKey)
  if (!result.ok && RETRY_STATUS.includes(result.status)) {
    await sleep(2000)
    ;({ result, logId } = await callModel(primary, prompt, kind, quizId, shapeKey))
    for (const fallback of FALLBACK_MODELS.filter((m) => m !== primary)) {
      if (result.ok) break
      used = fallback
      ;({ result, logId } = await callModel(fallback, prompt, kind, quizId, shapeKey))
    }
  }
  return { result, logId, used }
}

// Every step is evaluated with the existing evaluator. A step may only use numbers from the question, the fixed
// atomic masses, 100/1000/22.4 and earlier step values. The final value must equal the last step and the value
// of the teacher's correct option. Returns the steps, or the reason the solution is not stored.
function verifySolve(steps: unknown, final: unknown, q: QuizQuestion): { steps: string[] } | { failure: string } {
  if (
    !Array.isArray(steps) ||
    steps.length === 0 ||
    steps.length > 12 ||
    steps.some((x) => typeof x !== 'string' || !x.trim() || x.length > 200)
  ) {
    return { failure: 'bad_format' }
  }
  const target = optionValue(q.options.find((o) => o.label === q.correct_label)?.text ?? '')
  if (!target) return { failure: 'correct_option_not_numeric' }

  const allowed = new Set<string>()
  for (const n of [...numbers(q.text), ...Object.values(ATOMIC_MASSES), ...SOLUTION_CONSTANTS]) {
    const v = evaluate(n)
    if (v) allowed.add(ratKey(v))
  }
  const out: string[] = []
  let last: Rat | null = null
  for (const raw of steps as string[]) {
    const step = raw.trim()
    if (step.includes('%')) return { failure: 'percent_sign' }
    const parts = step.split('=').map((x) => x.trim())
    if (parts.length < 2 || parts.some((x) => !x)) return { failure: 'step_format' }
    const values = parts.map(evaluate)
    if (values.some((v) => v === null)) return { failure: 'not_arithmetic' }
    const vs = values as Rat[]
    if (!vs.every((v) => eq(v, vs[0]))) return { failure: `steps_not_equal (${step})` }
    const notAllowed = numbers(parts[0]).filter((n) => {
      const v = evaluate(n)
      return !v || !allowed.has(ratKey(v))
    })
    if (notAllowed.length) return { failure: `number_not_allowed (${notAllowed[0]})` }
    allowed.add(ratKey(vs[0]))
    last = vs[0]
    out.push(step)
  }
  const finalValue = typeof final === 'string' || typeof final === 'number' ? evaluate(String(final)) : null
  if (!finalValue || !last || !eq(finalValue, last)) return { failure: 'final_not_last_step' }
  if (!eq(finalValue, target)) return { failure: `final_value_mismatch (${fmt(finalValue)} vs correct ${fmt(target)})` }
  return { steps: out }
}

async function handleSolve(input: { questions?: unknown; quiz_id?: string; model?: string }) {
  const questions = parseQuestions(input.questions)
  if (!questions) return json({ error: 'questions with position, text, options and correct_label are required' }, 400)
  const quizId = input.quiz_id ?? null
  // Only questions where every option is a plain number can have a verified solution.
  const numeric = questions.filter((q) => q.options.every((o) => optionValue(o.text) !== null))
  const status: Record<string, string> = {}
  const solutions: Record<string, string[] | null> = {}
  for (const q of questions) {
    solutions[q.position] = null
    if (!numeric.includes(q)) status[q.position] = 'not_numeric'
  }
  let used = input.model ?? SOLVE_MODEL
  if (numeric.length > 0) {
    const run = await runChain(used, buildSolvePrompt(numeric), 'solve', quizId, 'questions')
    used = run.used
    if (!run.result.ok) return json({ error: run.result.error }, 502)
    // deno-lint-ignore no-explicit-any
    const rows = (run.result.data as any).questions as any[]
    for (const q of numeric) {
      const row = rows.find((r) => r?.position === q.position)
      if (!row) {
        status[q.position] = 'hidden: no_solution'
        continue
      }
      const v = verifySolve(row.solution_steps, row.final, q)
      if ('steps' in v) {
        solutions[q.position] = v.steps
        status[q.position] = 'verified'
      } else {
        status[q.position] = `hidden: ${v.failure}`
      }
    }
    await db
      .from('ai_calls')
      .update({ details: { step: 'solve', prompt_version: SOLVE_PROMPT_VERSION, solution_status: status } })
      .eq('id', run.logId)
  }
  return json({
    step: 'solve',
    questions: questions.map((q) => ({ position: q.position, solution: solutions[q.position] })),
    solution_status: status,
    model: used,
    prompt_version: SOLVE_PROMPT_VERSION,
  })
}

// deno-lint-ignore no-explicit-any
function parseStats(raw: any): TopicStat[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 40) return null
  const out: TopicStat[] = []
  for (const t of raw) {
    if (typeof t?.topic !== 'string' || !t.topic.trim() || t.topic.length > 120) return null
    const nums = [t.questions, t.students, t.weak_students, t.avg_accuracy]
    if (nums.some((n) => !Number.isFinite(n) || n < 0 || n > 100000)) return null
    out.push({
      topic: t.topic,
      questions: t.questions,
      students: t.students,
      weak_students: t.weak_students,
      avg_accuracy: t.avg_accuracy,
    })
  }
  return out
}

async function handleClassSummary(input: { stats?: unknown; quiz_id?: string; model?: string }) {
  const stats = parseStats(input.stats)
  if (!stats) return json({ error: 'stats (per-topic numbers) are required' }, 400)
  const quizId = input.quiz_id ?? null
  const run = await runChain(input.model ?? DEFAULT_MODEL, buildSummaryPrompt(stats), 'class-summary', quizId, 'focus_topics')
  if (!run.result.ok) return json({ error: run.result.error }, 502)
  // deno-lint-ignore no-explicit-any
  const data = run.result.data as any

  // Only numbers from the input may appear in the text; students_weak always comes from the input.
  const allowedNumbers = new Set(
    stats.flatMap((t) => [t.questions, t.students, t.weak_students, t.avg_accuracy].map(String)),
  )
  // topic labels (for example "K07") contain digits that are not statistics, so they are removed first
  const withoutTopics = (text: string) =>
    stats.reduce((t, s) => t.split(s.topic).join(' '), text).replace(/Kd{2}/g, ' ')
  const onlyInputNumbers = (text: string) => numbers(withoutTopics(text)).every((n) => allowedNumbers.has(n))
  const focus = (Array.isArray(data.focus_topics) ? data.focus_topics : [])
    // deno-lint-ignore no-explicit-any
    .map((f: any) => ({ f, stat: stats.find((t) => t.topic === f?.topic) }))
    // deno-lint-ignore no-explicit-any
    .filter(({ f, stat }: any) => stat && stat.weak_students > 0 && typeof f?.why === 'string' && onlyInputNumbers(f.why))
    // deno-lint-ignore no-explicit-any
    .map(({ f, stat }: any) => ({ topic: stat.topic, students_weak: stat.weak_students, why: f.why.trim() }))
    .slice(0, 3)
  const plan = (Array.isArray(data.next_lesson_plan) ? data.next_lesson_plan : [])
    .filter((x: unknown) => typeof x === 'string' && x.trim() && onlyInputNumbers(x))
    .map((x: string) => x.trim())
    .slice(0, 4)
  const summary = { focus_topics: focus, next_lesson_plan: plan }

  await db
    .from('ai_calls')
    .update({
      details: { step: 'class-summary', prompt_version: SUMMARY_PROMPT_VERSION, kept: { focus: focus.length, plan: plan.length } },
    })
    .eq('id', run.logId)
  // cache per quiz
  if (quizId) {
    await db
      .from('quizzes')
      .update({
        class_summary: { summary, model: run.used, prompt_version: SUMMARY_PROMPT_VERSION, at: new Date().toISOString() },
      })
      .eq('id', quizId)
  }
  return json({ step: 'class-summary', summary, model: run.used, prompt_version: SUMMARY_PROMPT_VERSION })
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
  const { quiz_id, group_id, text, model, step } = input ?? {}
  if (step === 'solve' || step === 'class-summary') {
    if (model != null && !/^[A-Za-z0-9._-]+$/.test(model)) return json({ error: 'Invalid model' }, 400)
    if (quiz_id != null && !/^[0-9a-f-]{36}$/i.test(quiz_id)) return json({ error: 'Invalid quiz_id' }, 400)
    return step === 'solve' ? handleSolve(input) : handleClassSummary(input)
  }
  if (step !== 'extract' && step !== 'reasons') {
    return json({ error: 'step must be "extract", "reasons", "solve" or "class-summary"' }, 400)
  }
  if (model != null && !/^[A-Za-z0-9._-]+$/.test(model)) return json({ error: 'Invalid model' }, 400)
  if (quiz_id != null && !/^[0-9a-f-]{36}$/i.test(quiz_id)) return json({ error: 'Invalid quiz_id' }, 400)
  if (group_id != null && !/^[0-9a-f-]{36}$/i.test(group_id)) return json({ error: 'Invalid group_id' }, 400)

  // The group decides the subject: chemistry uses K01..K33 and the chemistry prompts; everything else is math (v5).
  let groupId: string | null = group_id ?? null
  if (!groupId && quiz_id) {
    const { data } = await db.from('quizzes').select('group_id').eq('id', quiz_id).maybeSingle()
    groupId = data?.group_id ?? null
  }
  const { data: group } = groupId
    ? await db.from('groups').select('subject').eq('id', groupId).maybeSingle()
    : { data: null }
  const chemistry = group?.subject === 'chemistry'

  let prompt: string
  let questions: QuizQuestion[] | null = null
  if (step === 'extract') {
    if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT) {
      return json({ error: `text is required (max ${MAX_TEXT} characters)` }, 400)
    }
    prompt = chemistry ? buildKimyaExtractPrompt(text) : buildExtractPrompt(text, TOPICS)
  } else {
    questions = parseQuestions(input.questions)
    if (!questions) return json({ error: 'questions with position, text, options and correct_label are required' }, 400)
    prompt = chemistry ? buildKimyaReasonsPrompt(questions) : buildReasonsPrompt(questions, TOPICS)
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

  if (chemistry) {
    if (step === 'extract') {
      const ex = cleanExtractedKimya(result.data)
      await db
        .from('ai_calls')
        .update({
          details: { step, subject: 'chemistry', prompt_version: KIMYA_PROMPT_VERSION, invalid_topics: ex.invalidTopics },
        })
        .eq('id', logId)
      return json({
        step,
        questions: ex.questions,
        topics: KIMYA_IDS,
        invalid_topics: ex.invalidTopics,
        model: used,
        prompt_version: KIMYA_PROMPT_VERSION,
      })
    }
    const kc = cleanReasonsKimya(result.data, questions!)
    await db
      .from('ai_calls')
      .update({
        details: {
          step,
          subject: 'chemistry',
          prompt_version: KIMYA_PROMPT_VERSION,
          unknown: kc.unknown,
          per_option: kc.perOption,
          correct_option_reasons_dropped: kc.droppedCorrect,
        },
      })
      .eq('id', logId)
    return json({
      step,
      questions: kc.questions,
      unknown_reasons: kc.unknown,
      per_option: kc.perOption,
      model: used,
      prompt_version: KIMYA_PROMPT_VERSION,
    })
  }

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

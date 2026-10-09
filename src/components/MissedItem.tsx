import type { Missed } from '../lib/scoring'

export default function MissedItem({
  item,
  answerLabel,
  showReason = true,
}: {
  item: Missed
  answerLabel: string
  showReason?: boolean
}) {
  const { q, chosen, misconception, ranOut } = item
  const textOf = (label: string) => q.options.find((o) => o.label === label)?.text ?? ''

  return (
    <div className="card space-y-3">
      <p className="whitespace-pre-line font-semibold">
        <span className="mono mr-1">{q.position}.</span> {q.text}
      </p>
      <p className="rounded-input bg-warn-bg px-3 py-2 text-warn">
        {chosen
          ? `${answerLabel}: ${chosen}) ${textOf(chosen)}`
          : ranOut
            ? 'Vaxt çatmayıb'
            : 'Boş buraxılıb'}
      </p>
      <p className="rounded-input bg-ok-bg px-3 py-2 font-semibold text-ok">
        Düzgün cavab: {q.correct_label}) {textOf(q.correct_label)}
      </p>
      {q.solution && q.solution.length > 0 && (
        <div className="space-y-1">
          <p className="font-semibold">Düzgün həll</p>
          <ol className="mono list-decimal space-y-1 pl-6 text-sm">
            {q.solution.map((step, i) => (
              <li key={i}>{step.replaceAll('*', '×')}</li>
            ))}
          </ol>
        </div>
      )}
      {showReason && misconception && (
        <p className="text-sm text-muted">
          Ehtimal olunan səbəb: {misconception.reason}
          {misconception.calculation && <> (ehtimal olunan hesablama: {misconception.calculation})</>}
        </p>
      )}
    </div>
  )
}

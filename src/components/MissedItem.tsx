import type { Missed } from '../lib/scoring'

export default function MissedItem({ item, answerLabel }: { item: Missed; answerLabel: string }) {
  const { q, chosen, misconception, ranOut } = item
  const textOf = (label: string) => q.options.find((o) => o.label === label)?.text ?? ''

  return (
    <div className="space-y-1 rounded-xl border border-gray-300 p-3">
      <p className="whitespace-pre-line font-medium">
        {q.position}. {q.text}
      </p>
      <p className="text-red-700">
        {chosen
          ? `${answerLabel}: ${chosen}) ${textOf(chosen)}`
          : ranOut
            ? 'Vaxt çatmayıb'
            : 'Boş buraxılıb'}
      </p>
      <p className="text-green-700">
        Düzgün cavab: {q.correct_label}) {textOf(q.correct_label)}
      </p>
      {misconception && (
        <p className="text-sm text-gray-700">
          Ehtimal olunan səbəb: {misconception.reason}
          {misconception.unchecked && <> (yoxlanılmayıb)</>}
          {misconception.calculation && <> (ehtimal olunan hesablama: {misconception.calculation})</>}
        </p>
      )}
    </div>
  )
}

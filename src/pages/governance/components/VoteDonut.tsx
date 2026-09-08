import { VOTE_COLORS, VOTE_ORDER } from '@/pages/governance/components/voteColors'
import { VOTE_LABELS, type Tally } from '@/lib/governance'

interface Props {
  tally: Tally
  size?: number
}

/**
 * The split as a ring, with whichever option leads named in the middle.
 *
 * A ring rather than a pie because the hole is where the headline figure goes,
 * and that figure — "Yes 100%" — is the thing anyone actually reads off this.
 *
 * Drawn with `stroke-dasharray` on a single circle per segment rather than
 * with arc paths: the arithmetic is one circumference and a running offset,
 * which is far harder to get subtly wrong than four sets of arc endpoints.
 */
export default function VoteDonut({ tally, size = 168 }: Props) {
  const cast = tally.yes + tally.abstain + tally.no + tally.veto

  const amounts: Record<(typeof VOTE_ORDER)[number], bigint> = {
    YES: tally.yes,
    ABSTAIN: tally.abstain,
    NO: tally.no,
    NO_WITH_VETO: tally.veto
  }

  const stroke = 14
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius

  if (cast <= 0n) {
    return (
      <div
        className="flex items-center justify-center rounded-pill border-[14px] border-surface text-label text-text-faint"
        style={{ width: size, height: size }}
      >
        No votes yet
      </div>
    )
  }

  const share = (value: bigint) => Number((value * 1_000_000n) / cast) / 1_000_000

  const leader = VOTE_ORDER.reduce((best, option) =>
    amounts[option] > amounts[best] ? option : best
  )

  let offset = 0

  return (
    <div className="relative" style={{ width: size, height: size }}>
      {/* Rotated so the first segment starts at twelve o'clock rather than at
          three, which is where SVG's zero angle is. */}
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        {VOTE_ORDER.map((option) => {
          const fraction = share(amounts[option])
          if (fraction <= 0) return null

          const length = fraction * circumference
          const dash = `${length} ${circumference - length}`
          const thisOffset = offset
          offset += length

          return (
            <circle
              key={option}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={VOTE_COLORS[option]}
              strokeWidth={stroke}
              strokeDasharray={dash}
              strokeDashoffset={-thisOffset}
            />
          )
        })}
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-label text-text-muted">{VOTE_LABELS[leader]}</span>
        <span className="text-headline tabular-nums">{(share(amounts[leader]) * 100).toFixed(2)}%</span>
      </div>
    </div>
  )
}

import type { ValidatorVote } from '@/hooks/useValidatorVotes'
import { DISPLAY_DENOM } from '@/chains/secret4'
import { formatDisplayAmount } from '@/lib/format'
import { VOTE_LABELS } from '@/lib/governance'
import { squarify } from '@/lib/treemap'
import { VOTE_COLORS, VOTE_ORDER } from '@/pages/governance/components/voteColors'

interface Props {
  votes: ValidatorVote[]
  loading?: boolean
  error?: string
}

/*
 * A virtual canvas, not pixels: `squarify` only needs an aspect ratio to
 * decide how square each tile comes out, and every tile below is positioned
 * in percent of it — so the layout holds however wide the real column ends up.
 * The ratio is roughly this section's own at the two-column breakpoint.
 */
const CANVAS_WIDTH = 720
const CANVAS_HEIGHT = 220

/**
 * Every bonded validator, sized by voting power and coloured by how it voted
 * — grey for one that has not.
 *
 * A treemap rather than a list: with 40-plus validators spanning three orders
 * of magnitude of stake, a list either sorts by power (and buries who voted
 * which way) or by vote (and buries how much of the chain that represents).
 * Tile area answers both at once.
 */
export default function ValidatorVoteMap({ votes, loading, error }: Props) {
  const bonded = votes
    .filter((v) => BigInt(v.validator.tokens) > 0n)
    .sort((a, b) => (BigInt(b.validator.tokens) > BigInt(a.validator.tokens) ? 1 : -1))

  if (error) {
    return (
      <p className="text-label text-text-faint" role="alert">
        Validator votes could not be read: {error}
      </p>
    )
  }

  if (bonded.length === 0) {
    if (loading) {
      return (
        <div
          className="w-full animate-pulse rounded-control bg-surface"
          style={{ aspectRatio: `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}` }}
          aria-busy
        />
      )
    }
    return <p className="text-label text-text-faint">No bonded validators to show.</p>
  }

  const rects = squarify(
    bonded.map((v) => Number(v.validator.tokens)),
    CANVAS_WIDTH,
    CANVAS_HEIGHT
  )

  return (
    <div className="flex flex-col gap-3">
      <div
        className="relative w-full overflow-hidden rounded-control"
        style={{ aspectRatio: `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}` }}
      >
        {bonded.map(({ validator, option }, index) => {
          const rect = rects[index]
          if (!rect) return null

          const label = option
            ? `${validator.moniker} — ${VOTE_LABELS[option]}`
            : `${validator.moniker} — has not voted`
          const showLabel = rect.width >= 56 && rect.height >= 22

          return (
            <div
              key={validator.address}
              title={`${label} (${formatDisplayAmount(validator.tokens)} ${DISPLAY_DENOM})`}
              className={
                option
                  ? 'absolute flex items-center justify-center overflow-hidden border border-bg p-1 text-center'
                  : 'absolute flex items-center justify-center overflow-hidden border border-bg bg-surface-3 p-1 text-center'
              }
              style={{
                left: `${(rect.x / CANVAS_WIDTH) * 100}%`,
                top: `${(rect.y / CANVAS_HEIGHT) * 100}%`,
                width: `${(rect.width / CANVAS_WIDTH) * 100}%`,
                height: `${(rect.height / CANVAS_HEIGHT) * 100}%`,
                backgroundColor: option ? VOTE_COLORS[option] : undefined
              }}
            >
              {showLabel ? (
                <span
                  className={
                    option
                      ? 'truncate px-1 text-xs font-medium text-white'
                      : 'truncate px-1 text-xs font-medium text-text-faint'
                  }
                  style={option ? { textShadow: '0 1px 2px rgb(0 0 0 / 0.45)' } : undefined}
                >
                  {validator.moniker}
                </span>
              ) : null}
            </div>
          )
        })}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-label text-text-muted">
        {VOTE_ORDER.map((option) => (
          <span key={option} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="size-2.5 rounded-pill"
              style={{ backgroundColor: VOTE_COLORS[option] }}
            />
            {VOTE_LABELS[option]}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-pill bg-surface-3" />
          Not voted
        </span>
      </div>
    </div>
  )
}

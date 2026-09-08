import { cn } from '@/lib/cn'
import { STATUS_LABELS, type ProposalStatus } from '@/lib/governance'

/**
 * One colour per outcome, and a filled tint rather than a grey chip with
 * coloured text.
 *
 * Scanning a grid of proposals is almost entirely the question "which of these
 * can I still act on", so the status has to answer it at a glance rather than
 * on being read. The two live states also carry a dot, which is the difference
 * between a label describing a state and one describing a result.
 *
 * The tint comes from `color-mix` on the same token as the text, so it tracks
 * the theme instead of being a second hex that has to be kept in step — the
 * design tokens are full colours, not the bare channels Tailwind's `/15`
 * opacity syntax needs.
 */
const TONES: Record<ProposalStatus, { color: string; live?: boolean }> = {
  PROPOSAL_STATUS_UNSPECIFIED: { color: '#8b93a3' },
  PROPOSAL_STATUS_DEPOSIT_PERIOD: { color: '#4f8fe8', live: true },
  PROPOSAL_STATUS_VOTING_PERIOD: { color: 'var(--color-accent)', live: true },
  PROPOSAL_STATUS_PASSED: { color: 'var(--color-positive)' },
  PROPOSAL_STATUS_REJECTED: { color: 'var(--color-negative)' },
  // Passed its vote and then errored on execution — not the same as rejected,
  // and mistaking one for the other misreads the chain's history.
  PROPOSAL_STATUS_FAILED: { color: '#8b93a3' }
}

export default function StatusBadge({
  status,
  className
}: {
  status: ProposalStatus
  className?: string
}) {
  const tone = TONES[status] ?? TONES.PROPOSAL_STATUS_UNSPECIFIED

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill px-2.5 py-0.5',
        'text-label font-semibold',
        className
      )}
      style={{
        color: tone.color,
        backgroundColor: `color-mix(in srgb, ${tone.color} 16%, transparent)`
      }}
    >
      {tone.live ? (
        <span
          aria-hidden
          className="size-1.5 rounded-pill motion-safe:animate-pulse"
          style={{ backgroundColor: tone.color }}
        />
      ) : null}
      {STATUS_LABELS[status] ?? 'Unknown'}
    </span>
  )
}

import { cn } from '@/lib/cn'
import { STATUS_LABELS, type ProposalStatus } from '@/lib/governance'

/**
 * Five outcomes and one that is still open, told apart by colour rather than by
 * reading the word: what a governance list is scanned for is which proposals
 * can still be voted on, and that one is the only status carrying the accent.
 */
const TONES: Record<ProposalStatus, string> = {
  PROPOSAL_STATUS_UNSPECIFIED: 'bg-surface text-text-faint',
  PROPOSAL_STATUS_DEPOSIT_PERIOD: 'bg-surface text-text-muted',
  PROPOSAL_STATUS_VOTING_PERIOD: 'bg-accent-container text-accent',
  PROPOSAL_STATUS_PASSED: 'bg-surface text-positive',
  PROPOSAL_STATUS_REJECTED: 'bg-surface text-negative',
  // Passed its vote and then errored on execution — not the same as rejected,
  // and mistaking one for the other misreads the chain's history.
  PROPOSAL_STATUS_FAILED: 'bg-surface text-text-muted'
}

export default function StatusBadge({ status }: { status: ProposalStatus }) {
  return (
    <span
      className={cn(
        'shrink-0 whitespace-nowrap rounded-pill px-2.5 py-0.5 text-label font-medium',
        TONES[status] ?? TONES.PROPOSAL_STATUS_UNSPECIFIED
      )}
    >
      {STATUS_LABELS[status] ?? 'Unknown'}
    </span>
  )
}

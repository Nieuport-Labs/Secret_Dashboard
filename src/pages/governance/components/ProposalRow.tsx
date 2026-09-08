import { Check, Zap } from 'lucide-react'

import StatusBadge from '@/pages/governance/components/StatusBadge'
import TallyBar from '@/pages/governance/components/TallyBar'
import {
  VOTE_LABELS,
  evaluate,
  messageTypeLabel,
  type GovParams,
  type Proposal,
  type Tally,
  type VoteOption
} from '@/lib/governance'

interface Props {
  proposal: Proposal
  /** Live count, for a proposal still open. Closed ones carry their own. */
  tally?: Tally
  params?: GovParams
  bondedTokens: bigint
  myVote?: VoteOption
  onOpen: () => void
}

/** "3 days left", or "ended 2 Feb". */
function timing(proposal: Proposal): string | undefined {
  const open = proposal.status === 'PROPOSAL_STATUS_VOTING_PERIOD'
  const deadline = open
    ? proposal.votingEndTime
    : proposal.status === 'PROPOSAL_STATUS_DEPOSIT_PERIOD'
      ? proposal.depositEndTime
      : undefined

  if (!deadline) {
    return proposal.votingEndTime
      ? `Ended ${proposal.votingEndTime.toLocaleDateString()}`
      : undefined
  }

  const ms = deadline.getTime() - Date.now()
  if (ms <= 0) return 'Closing'

  const hours = Math.floor(ms / 3_600_000)
  if (hours < 1) return `${Math.max(1, Math.floor(ms / 60_000))} min left`
  if (hours < 48) return `${hours}h left`
  return `${Math.floor(hours / 24)} days left`
}

export default function ProposalRow({
  proposal,
  tally,
  params,
  bondedTokens,
  myVote,
  onOpen
}: Props) {
  const open = proposal.status === 'PROPOSAL_STATUS_VOTING_PERIOD'
  // While voting is open the stored tally is all zeros and the live one is the
  // only true figure; once closed, the stored one is what the chain acted on.
  const shown = open ? tally : proposal.finalTally
  const outcome =
    shown && params ? evaluate(shown, bondedTokens, params, proposal.expedited) : undefined

  const when = timing(proposal)

  return (
    <li
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      }}
      className="flex cursor-pointer flex-col gap-2.5 rounded-control px-2 py-3.5 transition-colors duration-[var(--duration-short)] ease-[var(--ease-standard)] hover:bg-surface-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <div className="flex items-start gap-3">
        <span className="w-10 shrink-0 pt-px text-label tabular-nums text-text-faint">
          #{proposal.id}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-body font-medium">{proposal.title}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-label text-text-faint">
            {proposal.messageTypes.length > 0 ? (
              <span className="truncate">{messageTypeLabel(proposal.messageTypes[0])}</span>
            ) : null}
            {when ? <span>{when}</span> : null}
          </span>
        </span>

        <span className="flex shrink-0 items-center gap-2">
          {/*
            Expedited is not a label for its own sake: the voting period is a
            day instead of a week and the yes bar is higher, so a proposal
            carrying it is read under different rules than the one above it.
          */}
          {proposal.expedited ? (
            <span
              className="hidden items-center gap-1 rounded-pill bg-surface px-2 py-0.5 text-label text-text-muted sm:inline-flex"
              title="Shorter voting period, higher threshold to pass"
            >
              <Zap size={11} aria-hidden />
              Expedited
            </span>
          ) : null}
          {myVote ? (
            <span
              className="inline-flex items-center gap-1 rounded-pill bg-accent-container px-2 py-0.5 text-label text-accent"
              title={`You voted ${VOTE_LABELS[myVote]}`}
            >
              <Check size={11} aria-hidden />
              {VOTE_LABELS[myVote]}
            </span>
          ) : null}
          <StatusBadge status={proposal.status} />
        </span>
      </div>

      {/*
        Indented to the title, not to the row: the number in the gutter is a
        label for the whole thing, and a bar starting under it would read as
        belonging to the number.
      */}
      {shown ? (
        <div className="pl-[3.25rem]">
          {/*
            The figures show for a closed proposal too, not just an open one.
            Without them a proposal rejected purely for want of turnout — all
            green, every vote in favour, and "Rejected" beside it — reads as a
            bug in the page rather than as what actually happened.
          */}
          <TallyBar tally={shown} outcome={outcome} historic={!open} />
        </div>
      ) : null}
    </li>
  )
}

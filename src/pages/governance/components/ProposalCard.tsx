import { Check, Clock, Zap } from 'lucide-react'
import { Link } from 'react-router-dom'

import StatusBadge from '@/pages/governance/components/StatusBadge'
import TallyBar from '@/pages/governance/components/TallyBar'
import { cn } from '@/lib/cn'
import {
  VOTE_LABELS,
  evaluate,
  messageTypeLabel,
  timeRemaining,
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
}

export default function ProposalCard({ proposal, tally, params, bondedTokens, myVote }: Props) {
  const open = proposal.status === 'PROPOSAL_STATUS_VOTING_PERIOD'
  // While voting is open the stored tally is all zeros and the live one is the
  // only true figure; once closed, the stored one is what the chain acted on.
  const shown = open ? tally : proposal.finalTally
  const outcome =
    shown && params ? evaluate(shown, bondedTokens, params, proposal.expedited) : undefined

  const expires = timeRemaining(proposal)

  return (
    <li>
      {/*
        A real link, not a click handler on a div — so a proposal can be opened
        in a new tab, copied, or shared, which is most of what anyone does with
        a governance proposal.
      */}
      <Link
        to={`/governance/${proposal.id}`}
        className={cn(
          'card flex h-full flex-col gap-3 p-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
          'transition-colors duration-[var(--duration-short)] ease-[var(--ease-standard)] hover:bg-surface-2'
        )}
        /*
          An open proposal gets an accent edge, not just a badge. In a grid of
          two dozen cards the badge is a small thing in a corner, and the one
          question the grid has to answer from across the page is which of
          these can still be voted on.
        */
        style={
          open
            ? { borderColor: 'color-mix(in srgb, var(--color-accent) 50%, transparent)' }
            : undefined
        }
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge status={proposal.status} />
          {myVote ? (
            <span className="inline-flex items-center gap-1 rounded-pill bg-accent-container px-2 py-0.5 text-label font-medium text-accent">
              <Check size={11} aria-hidden />
              Voted {VOTE_LABELS[myVote]}
            </span>
          ) : null}
          {proposal.expedited ? (
            <span
              className="inline-flex items-center gap-1 rounded-pill bg-surface px-2 py-0.5 text-label text-text-muted"
              title="Shorter voting period, higher threshold to pass"
            >
              <Zap size={11} aria-hidden />
              Expedited
            </span>
          ) : null}
          {expires ? (
            <span className="inline-flex items-center gap-1 rounded-pill bg-surface px-2 py-0.5 text-label text-text-muted">
              <Clock size={11} aria-hidden />
              {expires}
            </span>
          ) : null}
        </div>

        {/*
          Two lines, then an ellipsis. A governance title runs anywhere from
          three words to a sentence, and letting them size their own cards
          leaves a grid where no two rows line up.
        */}
        <h2 className="line-clamp-2 text-body font-medium">
          <span className="text-text-faint">#{proposal.id}</span> {proposal.title}
        </h2>

        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-label text-text-faint">
          {proposal.messageTypes.length > 0 ? (
            <span>{messageTypeLabel(proposal.messageTypes[0])}</span>
          ) : null}
          {!open && proposal.votingEndTime ? (
            <span>Ended {proposal.votingEndTime.toLocaleDateString()}</span>
          ) : null}
        </div>

        {/* Pushed to the bottom so every card's bar sits on the same line,
            however tall the title above it turned out. */}
        {shown ? (
          <div className="mt-auto pt-1">
            <TallyBar tally={shown} outcome={outcome} historic={!open} compact />
          </div>
        ) : null}
      </Link>
    </li>
  )
}

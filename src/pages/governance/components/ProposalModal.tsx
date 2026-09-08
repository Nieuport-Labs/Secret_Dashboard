import { Check, ExternalLink } from 'lucide-react'
import { useState } from 'react'

import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import StatusBadge from '@/pages/governance/components/StatusBadge'
import TallyBar from '@/pages/governance/components/TallyBar'
import { DISPLAY_DENOM, explorerAccountUrl } from '@/chains/secret4'
import { cn } from '@/lib/cn'
import { formatDisplayAmount, shortenAddress } from '@/lib/format'
import {
  VOTE_LABELS,
  evaluate,
  messageTypeLabel,
  type GovParams,
  type Proposal,
  type Tally,
  type VoteOption
} from '@/lib/governance'
import type { ActionState } from '@/hooks/useStakingActions'

const OPTIONS: VoteOption[] = ['YES', 'NO', 'NO_WITH_VETO', 'ABSTAIN']

interface Props {
  proposal: Proposal
  tally?: Tally
  params?: GovParams
  bondedTokens: bigint
  myVote?: VoteOption
  /** Whether a wallet is connected at all. Voting needs one; reading does not. */
  connected: boolean
  state: ActionState
  onVote: (option: VoteOption) => void
  onClose: () => void
}

export default function ProposalModal({
  proposal,
  tally,
  params,
  bondedTokens,
  myVote,
  connected,
  state,
  onVote,
  onClose
}: Props) {
  const [choice, setChoice] = useState<VoteOption | undefined>(myVote)

  const open = proposal.status === 'PROPOSAL_STATUS_VOTING_PERIOD'
  const shown = open ? tally : proposal.finalTally
  const outcome =
    shown && params ? evaluate(shown, bondedTokens, params, proposal.expedited) : undefined

  const sending = state.kind === 'sending'

  return (
    <Modal open onClose={onClose} title={proposal.title}>
      {/*
        Takes whatever height is left once the heading and the vote controls
        have theirs, and scrolls inside that. A fixed `max-h` here would be a
        guess at the other two, and on a short window it guesses wrong in the
        direction that pushes the vote buttons off the screen.
      */}
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={proposal.status} />
          <span className="text-label text-text-faint">#{proposal.id}</span>
          {proposal.expedited ? (
            <span className="rounded-pill bg-surface px-2 py-0.5 text-label text-text-muted">
              Expedited
            </span>
          ) : null}
          {proposal.messageTypes.map((type) => (
            <span key={type} className="rounded-pill bg-surface px-2 py-0.5 text-label text-text-muted">
              {messageTypeLabel(type)}
            </span>
          ))}
        </div>

        {/*
          The proposer's own text, rendered as plain text and nothing else.
          Anyone who can pay the deposit can put anything in here, and secret-4's
          own history has proposals that are purely phishing bait — so no
          markdown, and above all no live links: turning a stranger's URL into
          something clickable inside a wallet is the exact favour not to do.
          `whitespace-pre-wrap` keeps their paragraphs; `break-words` keeps a
          pasted URL from stretching the dialog.
        */}
        {proposal.summary ? (
          <p className="whitespace-pre-wrap break-words text-base text-text-muted">
            {proposal.summary}
          </p>
        ) : (
          <p className="text-base text-text-faint">This proposal has no description.</p>
        )}

        {shown ? <TallyBar tally={shown} outcome={outcome} legend historic={!open} /> : null}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-label">
          <Fact label="Deposit">
            {formatDisplayAmount(proposal.totalDeposit)} {DISPLAY_DENOM}
          </Fact>
          <Fact label={open ? 'Voting ends' : 'Voting ended'}>
            {proposal.votingEndTime?.toLocaleString() ?? '—'}
          </Fact>
          <Fact label="Submitted">{proposal.submitTime?.toLocaleDateString() ?? '—'}</Fact>
          <Fact label="Proposer">
            {proposal.proposer ? (
              <a
                href={explorerAccountUrl(proposal.proposer)}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 text-accent hover:underline"
                onClick={(event) => event.stopPropagation()}
              >
                {shortenAddress(proposal.proposer)}
                <ExternalLink size={11} aria-hidden />
              </a>
            ) : (
              '—'
            )}
          </Fact>
        </dl>
      </div>

      {open ? (
        <div className="flex shrink-0 flex-col gap-3 border-t border-border pt-4">
          {myVote ? (
            <p className="flex items-center gap-1.5 text-base text-text-muted">
              <Check size={14} aria-hidden className="text-accent" />
              You voted <span className="font-medium text-text">{VOTE_LABELS[myVote]}</span>. Voting
              again replaces it.
            </p>
          ) : null}

          <div className="grid grid-cols-2 gap-2">
            {OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={choice === option}
                disabled={!connected || sending}
                onClick={() => setChoice(option)}
                className={cn(
                  'state-layer rounded-control border px-3 py-2.5 text-base font-medium',
                  'transition-colors duration-[var(--duration-short)] ease-[var(--ease-standard)]',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                  choice === option
                    ? 'border-transparent bg-accent-container text-accent'
                    : 'border-border text-text-muted'
                )}
              >
                {VOTE_LABELS[option]}
              </button>
            ))}
          </div>

          {state.kind === 'failed' ? (
            <p className="break-words text-base text-negative" role="alert">
              {state.message}
            </p>
          ) : null}
          {state.kind === 'done' ? (
            <p className="text-base text-positive" role="status">
              Vote recorded.
            </p>
          ) : null}

          <Button
            block
            loading={sending}
            /*
              Re-submitting the same option is allowed by the chain but costs a
              fee to change nothing, so it is only offered once the choice
              differs from what is already on record.
            */
            disabled={!connected || choice === undefined || choice === myVote}
            onClick={() => choice && onVote(choice)}
          >
            {connected
              ? myVote
                ? 'Change vote'
                : 'Cast vote'
              : 'Connect a wallet to vote'}
          </Button>

          {/*
            Voting power is delegated stake, full stop — a balance sitting
            unstaked counts for nothing. Someone who votes and sees no movement
            in the tally deserves to know why before they sign, not after.
          */}
          <p className="text-label text-text-faint">
            Your vote is weighted by what you have staked. Undelegated {DISPLAY_DENOM} carries no
            voting power.
          </p>
        </div>
      ) : null}
    </Modal>
  )
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-text-faint">{label}</dt>
      <dd className="mt-0.5 truncate text-text-muted">{children}</dd>
    </div>
  )
}

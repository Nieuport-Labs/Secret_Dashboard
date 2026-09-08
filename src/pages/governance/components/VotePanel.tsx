import { Check } from 'lucide-react'
import { useState } from 'react'

import Button from '@/components/ui/Button'
import { DISPLAY_DENOM } from '@/chains/secret4'
import { cn } from '@/lib/cn'
import { VOTE_LABELS, type VoteOption } from '@/lib/governance'
import { VOTE_COLORS, VOTE_ORDER } from '@/pages/governance/components/voteColors'
import type { ActionState } from '@/hooks/useStakingActions'

interface Props {
  myVote?: VoteOption
  /** Whether a wallet is connected at all. Voting needs one; reading does not. */
  connected: boolean
  /**
   * Whether this vote can actually be cast. In validator mode that is a
   * question about permission rather than connection: the wallet may be
   * connected and still hold no authority over the validator's vote.
   */
  canVote: boolean
  /** The validator this vote belongs to, when it is not the wallet's own. */
  votingAs?: string
  state: ActionState
  onVote: (option: VoteOption) => void
}

/** Casting or changing a vote. Only rendered while a proposal is actually open. */
export default function VotePanel({ myVote, connected, canVote, votingAs, state, onVote }: Props) {
  const [choice, setChoice] = useState<VoteOption | undefined>(myVote)
  const sending = state.kind === 'sending'

  return (
    <div className="card flex flex-col gap-4 p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-title">
          {votingAs
            ? myVote
              ? `Change ${votingAs}’s vote`
              : `Vote as ${votingAs}`
            : myVote
              ? 'Change your vote'
              : 'Cast your vote'}
        </h2>
        {myVote ? (
          <span className="flex items-center gap-1 text-label text-accent">
            <Check size={12} aria-hidden />
            Voted {VOTE_LABELS[myVote]}
          </span>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {VOTE_ORDER.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={choice === option}
            disabled={!canVote || sending}
            onClick={() => setChoice(option)}
            className={cn(
              'state-layer flex items-center gap-2 rounded-control border px-3 py-2.5 text-base font-medium',
              'transition-colors duration-[var(--duration-short)] ease-[var(--ease-standard)]',
              'disabled:cursor-not-allowed disabled:opacity-50',
              choice === option
                ? 'border-transparent bg-accent-container text-accent'
                : 'border-border text-text-muted'
            )}
          >
            {/* The same dot the bar and the ring use, so the option being
                chosen is visibly the segment it will grow. */}
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-pill"
              style={{ backgroundColor: VOTE_COLORS[option] }}
            />
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
          Re-submitting the same option is allowed by the chain but costs a fee
          to change nothing, so it is only offered once the choice differs from
          what is already on record.
        */
        disabled={!canVote || choice === undefined || choice === myVote}
        onClick={() => choice && onVote(choice)}
      >
        {!connected
          ? 'Connect a wallet to vote'
          : !canVote
            ? 'Not permitted to vote'
            : myVote
              ? 'Change vote'
              : 'Cast vote'}
      </Button>

      {/*
        Voting power is delegated stake, full stop — a balance sitting unstaked
        counts for nothing. Someone who votes and sees no movement in the tally
        deserves to know why before they sign, not after. For a validator that
        stake is its delegators', which is the whole reason its vote matters.
      */}
      {votingAs ? (
        connected && !canVote ? (
          <p className="text-label text-text-faint">
            {votingAs}’s operator has not granted this wallet permission to vote. The Validator screen
            has the command that would.
          </p>
        ) : (
          <p className="text-label text-text-faint">
            This vote is cast by {votingAs} and carries the stake delegated to it. Delegators who vote
            for themselves override it.
          </p>
        )
      ) : (
        <p className="text-label text-text-faint">
          Your vote is weighted by what you have staked. Undelegated {DISPLAY_DENOM} carries no voting
          power.
        </p>
      )}
    </div>
  )
}

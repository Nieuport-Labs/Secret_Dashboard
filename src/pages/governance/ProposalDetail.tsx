import { ArrowLeft, ExternalLink, Landmark } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import Button from '@/components/ui/Button'
import CollapsibleSection from '@/components/ui/CollapsibleSection'
import EmptyState from '@/components/ui/EmptyState'
import StatusBadge from '@/pages/governance/components/StatusBadge'
import ValidatorVoteMap from '@/pages/governance/components/ValidatorVoteMap'
import VoteDonut from '@/pages/governance/components/VoteDonut'
import VotePanel from '@/pages/governance/components/VotePanel'
import { VOTE_COLORS, VOTE_ORDER } from '@/pages/governance/components/voteColors'
import { DISPLAY_DENOM, explorerAccountUrl } from '@/chains/secret4'
import { cn } from '@/lib/cn'
import { formatDisplayAmount, shortenAddress } from '@/lib/format'
import {
  VOTE_LABELS,
  evaluate,
  messageTypeLabel,
  timeRemaining,
  type Tally,
  type VoteOption
} from '@/lib/governance'
import { useGovernanceActions } from '@/hooks/useGovernanceActions'
import { useProposal } from '@/hooks/useProposal'
import { useValidatorVotes } from '@/hooks/useValidatorVotes'
import { useWallet } from '@/store/wallet'

export default function ProposalDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const address = useWallet((state) => state.address)

  /** Shared between the donut, the breakdown list beside it and the
   *  validator chart below — hovering one dims the rest of all three. */
  const [hoveredOption, setHoveredOption] = useState<VoteOption | undefined>()

  const data = useProposal(id)
  const open = data.proposal?.status === 'PROPOSAL_STATUS_VOTING_PERIOD'
  /*
   * Individual votes are chain state the same as the tally, and are pruned
   * the moment a proposal is tallied — so this only ever asks while `open`,
   * same as the live tally above it.
   */
  const validatorVotes = useValidatorVotes(id, open)
  /*
   * Re-reading after a vote rather than patching the tally locally: it moves by
   * the voter's whole delegated stake, and guessing that number on the client
   * would show a figure the chain never agreed to.
   */
  const actions = useGovernanceActions(() => {
    data.refresh()
    validatorVotes.refresh()
  })

  if (data.notFound) {
    return (
      <EmptyState
        icon={Landmark}
        title={`No proposal #${id ?? ''}`}
        description="The chain has no proposal with that number."
        action={<Button onClick={() => navigate('/governance')}>Back to governance</Button>}
      />
    )
  }

  if (!data.proposal) {
    return (
      <div className="mx-auto flex max-w-[1100px] flex-col gap-6" aria-busy>
        <div className="h-4 w-40 animate-pulse rounded-control bg-surface" />
        <div className="h-9 w-2/3 animate-pulse rounded-control bg-surface" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
          <div className="h-72 animate-pulse rounded-card bg-surface" />
          <div className="h-72 animate-pulse rounded-card bg-surface" />
        </div>
        {data.error ? (
          <p className="text-base text-text-muted" role="alert">
            This proposal could not be read: {data.error}
          </p>
        ) : null}
      </div>
    )
  }

  const proposal = data.proposal
  const tally: Tally = (open ? data.tally : proposal.finalTally) ?? proposal.finalTally
  const outcome = data.params
    ? evaluate(tally, data.bondedTokens, data.params, proposal.expedited)
    : undefined

  const cast = tally.yes + tally.abstain + tally.no + tally.veto
  const amounts: Record<(typeof VOTE_ORDER)[number], bigint> = {
    YES: tally.yes,
    ABSTAIN: tally.abstain,
    NO: tally.no,
    NO_WITH_VETO: tally.veto
  }
  const share = (value: bigint) =>
    cast <= 0n ? 0 : Number((value * 1_000_000n) / cast) / 10_000

  const expires = timeRemaining(proposal)

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-6">
      <Link
        to="/governance"
        className="state-layer -ml-2 inline-flex w-fit items-center gap-2 rounded-pill px-2 py-1 text-base text-text-muted hover:text-text"
      >
        <ArrowLeft size={16} aria-hidden />
        Governance
      </Link>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={proposal.status} />
          {proposal.expedited ? (
            <span
              className="rounded-pill bg-surface px-2.5 py-0.5 text-label text-text-muted"
              title="Shorter voting period, higher threshold to pass"
            >
              Expedited
            </span>
          ) : null}
          {expires ? (
            <span className="rounded-pill bg-surface px-2.5 py-0.5 text-label text-text-muted">
              {expires}
            </span>
          ) : null}
        </div>

        <h1 className="text-display">
          <span className="text-text-faint">#{proposal.id}</span> {proposal.title}
        </h1>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <section className="card flex flex-col gap-4 p-5">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Fact label="Voting starts">{format(proposal.votingStartTime)}</Fact>
              <Fact label="Voting ends">{format(proposal.votingEndTime)}</Fact>
              <Fact label="Submitted">{format(proposal.submitTime)}</Fact>
              <Fact label="Deposit">
                {formatDisplayAmount(proposal.totalDeposit)} {DISPLAY_DENOM}
              </Fact>
            </div>
          </section>

          <CollapsibleSection title="Description">
            {/*
              The proposer's own text, rendered as plain text and nothing else.
              Anyone who can pay the deposit can put anything in here, and
              secret-4's own history has proposals that are purely phishing
              bait — so no markdown, and above all no live links: turning a
              stranger's URL into something clickable inside a wallet is the
              exact favour not to do.
            */}
            {proposal.summary ? (
              <p className="whitespace-pre-wrap break-words text-base text-text-muted">
                {proposal.summary}
              </p>
            ) : (
              <p className="text-base text-text-faint">This proposal has no description.</p>
            )}
          </CollapsibleSection>

          {proposal.messages.length > 0 ? (
            <CollapsibleSection title="Details" description="What this proposal executes if it passes.">
              {proposal.messages.map((message, index) => (
                <MessageFields key={index} message={message} />
              ))}
            </CollapsibleSection>
          ) : null}

          {open ? (
            <CollapsibleSection
              title="Validator votes"
              description="Validators that have voted so far, sized by their share of the network's voting power."
            >
              <ValidatorVoteMap
                votes={validatorVotes.votes}
                bondedTokens={data.bondedTokens}
                hoveredOption={hoveredOption}
                loading={validatorVotes.loading}
                error={validatorVotes.error}
              />
            </CollapsibleSection>
          ) : null}
        </div>

        <div className="flex flex-col gap-6">
          <section className="card flex flex-col items-center gap-4 p-5">
            <h2 className="self-start text-title">Vote details</h2>

            <VoteDonut tally={tally} hovered={hoveredOption} onHover={setHoveredOption} />

            {outcome ? (
              <div className="flex flex-wrap justify-center gap-2">
                <span className="rounded-pill bg-surface px-2.5 py-1 text-label tabular-nums text-text-muted">
                  Turnout{' '}
                  <span className={outcome.quorumMet ? 'text-positive' : 'text-text'}>
                    {open ? '' : '~'}
                    {(outcome.turnout * 100).toFixed(1)}%
                  </span>
                </span>
                <span className="rounded-pill bg-surface px-2.5 py-1 text-label tabular-nums text-text-muted">
                  Quorum {(outcome.quorum * 100).toFixed(1)}%
                </span>
                <span className="rounded-pill bg-surface px-2.5 py-1 text-label tabular-nums text-text-muted">
                  Threshold {(outcome.threshold * 100).toFixed(1)}%
                </span>
              </div>
            ) : null}

            {/*
              The same "measured against today's stake" caveat the list carries.
              The chain does not record what was bonded at the time, so for a
              closed proposal turnout is an estimate and says so.
            */}
            {!open && outcome ? (
              <p className="text-center text-label text-text-faint">
                Turnout is measured against the stake bonded today.
              </p>
            ) : null}

            <dl className="grid w-full grid-cols-2 gap-x-4 gap-y-3">
              {VOTE_ORDER.map((option) => (
                <div
                  key={option}
                  onPointerEnter={() => setHoveredOption(option)}
                  onPointerLeave={() => setHoveredOption(undefined)}
                  className={cn(
                    'min-w-0 cursor-default transition-opacity duration-[var(--duration-short)] ease-[var(--ease-standard)]',
                    hoveredOption !== undefined && hoveredOption !== option && 'opacity-30'
                  )}
                >
                  <dt className="flex items-center gap-1.5 text-label text-text-muted">
                    <span
                      aria-hidden
                      className="size-2.5 shrink-0 rounded-pill"
                      style={{ backgroundColor: VOTE_COLORS[option] }}
                    />
                    {VOTE_LABELS[option]}
                  </dt>
                  <dd className="mt-0.5 text-body font-medium tabular-nums">
                    {share(amounts[option]).toFixed(2)}%
                  </dd>
                  <dd className="truncate text-label tabular-nums text-text-faint">
                    {formatDisplayAmount(amounts[option])} {DISPLAY_DENOM}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          {open ? (
            <VotePanel
              myVote={data.myVote}
              connected={Boolean(address)}
              state={actions.state}
              onVote={(option) => void actions.vote(proposal.id, option)}
            />
          ) : null}

          {proposal.proposer ? (
            <section className="card flex flex-col gap-1.5 p-5">
              <h2 className="text-title">Proposer</h2>
              <a
                href={explorerAccountUrl(proposal.proposer)}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex w-fit items-center gap-1.5 text-base text-accent hover:underline"
              >
                {shortenAddress(proposal.proposer, 14, 6)}
                <ExternalLink size={12} aria-hidden />
              </a>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function format(date: Date | undefined): string {
  return date ? date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—'
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-label text-text-faint">{label}</dt>
      <dd className="mt-0.5 truncate text-base text-text-muted" title={String(children)}>
        {children}
      </dd>
    </div>
  )
}

/**
 * One proposal message, as a field table.
 *
 * Rendered from whatever keys the message happens to carry rather than from a
 * per-type layout: there are dozens of proposal types across Cosmos and
 * Secret's own modules, and a page that only knew a handful would show nothing
 * at all for the rest.
 */
function MessageFields({ message }: { message: Record<string, unknown> }) {
  const type = String(message['@type'] ?? '')
  const fields = Object.entries(message).filter(([key]) => key !== '@type')

  return (
    <div className="card flex flex-col gap-3 p-4">
      <span className="w-fit rounded-pill bg-surface px-2.5 py-0.5 text-label text-text-muted">
        {messageTypeLabel(type)}
      </span>

      <dl className="flex flex-col gap-2.5">
        {fields.map(([key, value]) => (
          <div key={key} className="grid gap-1 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
            <dt className="text-label text-text-faint">{key}</dt>
            {/*
              Values run from a short address to a nested upgrade plan, so they
              wrap and scroll rather than stretching the page. Plain text, like
              the description — this is still content a stranger wrote.
            */}
            <dd className="min-w-0 whitespace-pre-wrap break-words text-base text-text-muted">
              {typeof value === 'object' && value !== null
                ? JSON.stringify(value, null, 2)
                : String(value)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

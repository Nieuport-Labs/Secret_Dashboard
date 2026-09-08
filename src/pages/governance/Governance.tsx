import { Search } from 'lucide-react'
import { useMemo, useState } from 'react'

import Button from '@/components/ui/Button'
import ProposalCard from '@/pages/governance/components/ProposalCard'
import { cn } from '@/lib/cn'
import type { Proposal, ProposalStatus } from '@/lib/governance'
import { useGovernance } from '@/hooks/useGovernance'

/**
 * The filters worth having, which is not one per status. "Open" is what anyone
 * comes here to act on, "Decided" folds passed, rejected and failed together
 * because sorting a five-year archive by outcome is not a question anyone asks,
 * and "All" is the history in order.
 */
const FILTERS: Array<{ id: string; label: string; match?: (status: ProposalStatus) => boolean }> = [
  {
    id: 'open',
    label: 'Open',
    match: (status) =>
      status === 'PROPOSAL_STATUS_VOTING_PERIOD' || status === 'PROPOSAL_STATUS_DEPOSIT_PERIOD'
  },
  {
    id: 'decided',
    label: 'Decided',
    match: (status) =>
      status === 'PROPOSAL_STATUS_PASSED' ||
      status === 'PROPOSAL_STATUS_REJECTED' ||
      status === 'PROPOSAL_STATUS_FAILED'
  },
  { id: 'all', label: 'All' }
]

/** How many cards to show before "Show more" — the whole history is loaded. */
const PAGE = 24

export default function Governance() {
  const governance = useGovernance()

  /*
   * Opens on what can still be acted on, not on the archive. Anyone arriving
   * here is far likelier to be asking "is there anything to vote on" than to be
   * reading five years of decided proposals, and "Decided" and "All" are one
   * click away when they are not.
   */
  const [filterId, setFilterId] = useState('open')
  const [query, setQuery] = useState('')
  const [shown, setShown] = useState(PAGE)

  const filter = FILTERS.find((f) => f.id === filterId) ?? FILTERS[2]

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()

    return governance.proposals.filter((proposal: Proposal) => {
      if (filter.match && !filter.match(proposal.status)) return false
      if (!needle) return true

      // Number first, because "372" is how anyone refers to a proposal — and
      // an exact id match should not be buried under every proposal whose
      // description happens to contain the digits.
      if (proposal.id === needle) return true

      return (
        proposal.title.toLowerCase().includes(needle) ||
        proposal.summary.toLowerCase().includes(needle) ||
        proposal.id.includes(needle)
      )
    })
  }, [governance.proposals, filter, query])

  const visible = matches.slice(0, shown)
  const openCount = governance.proposals.filter(
    (p) => p.status === 'PROPOSAL_STATUS_VOTING_PERIOD'
  ).length

  const reset = (next: () => void) => {
    next()
    setShown(PAGE)
  }

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-7">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <h1 className="text-display">Governance</h1>
        {openCount > 0 ? (
          <p className="text-base text-text-muted">
            <span className="font-medium text-accent">{openCount}</span> open for voting
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2.5 rounded-control border border-border bg-surface px-3 py-2 sm:max-w-sm">
          <Search size={16} aria-hidden className="shrink-0 text-text-muted" />
          <input
            value={query}
            onChange={(event) => reset(() => setQuery(event.target.value))}
            placeholder="Search proposals"
            aria-label="Search proposals"
            className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-text-faint"
          />
        </div>

        <div className="flex items-center gap-1 rounded-pill border border-border p-1">
          {FILTERS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={filterId === option.id}
              onClick={() => reset(() => setFilterId(option.id))}
              className={cn(
                'state-layer rounded-pill px-3.5 py-1.5 text-sm font-medium',
                'transition-colors duration-[var(--duration-short)] ease-[var(--ease-standard)]',
                filterId === option.id
                  ? 'bg-accent-strong text-[var(--color-accent-text)]'
                  : 'text-text-muted'
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {governance.loading && governance.proposals.length === 0 ? (
        <div className="grid gap-4 lg:grid-cols-2" aria-busy>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-40 animate-pulse rounded-card bg-surface" />
          ))}
        </div>
      ) : matches.length === 0 ? (
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <p className="text-base text-text-muted">
            {query.trim()
              ? `Nothing matches “${query.trim()}”.`
              : filter.id === 'open'
                ? 'Nothing is open for voting right now.'
                : 'No proposals found.'}
          </p>
          {/*
            The page now opens on "Open", so a quiet week is the first thing a
            visitor sees. Say where the rest of it is rather than leaving them
            on an empty page to work out that the filter is doing this.
          */}
          {!query.trim() && filter.id === 'open' ? (
            <Button variant="soft" shape="control" size="sm" onClick={() => reset(() => setFilterId('all'))}>
              Browse all {governance.proposals.length} proposals
            </Button>
          ) : null}
        </div>
      ) : (
        <ul className="grid items-stretch gap-4 lg:grid-cols-2">
          {visible.map((proposal) => (
            <ProposalCard
              key={proposal.id}
              proposal={proposal}
              tally={governance.tallies.get(proposal.id)}
              params={governance.params}
              bondedTokens={governance.bondedTokens}
              myVote={governance.myVotes.get(proposal.id)}
            />
          ))}
        </ul>
      )}

      {visible.length < matches.length ? (
        <div className="flex justify-center">
          <Button variant="soft" shape="control" size="sm" onClick={() => setShown((n) => n + PAGE)}>
            Show more ({visible.length} of {matches.length})
          </Button>
        </div>
      ) : null}

      {governance.error ? (
        <p className="text-base text-text-muted" role="alert">
          Proposals could not be read: {governance.error}
        </p>
      ) : null}
    </div>
  )
}

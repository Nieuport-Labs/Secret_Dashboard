import { useState } from 'react'

import Button from '@/components/ui/Button'
import ProposalModal from '@/pages/governance/components/ProposalModal'
import ProposalRow from '@/pages/governance/components/ProposalRow'
import { cn } from '@/lib/cn'
import type { ProposalStatus } from '@/lib/governance'
import { useGovernance } from '@/hooks/useGovernance'
import { useGovernanceActions } from '@/hooks/useGovernanceActions'
import { useWallet } from '@/store/wallet'

/**
 * The filters worth having, which is not one per status. "Open" is what anyone
 * comes here to act on, "Decided" folds passed, rejected and failed together
 * because sorting a five-year archive by outcome is not a question anyone asks,
 * and "All" is the history in order.
 */
const FILTERS: Array<{ id: string; label: string; status?: ProposalStatus }> = [
  { id: 'open', label: 'Open', status: 'PROPOSAL_STATUS_VOTING_PERIOD' },
  { id: 'deposit', label: 'In deposit', status: 'PROPOSAL_STATUS_DEPOSIT_PERIOD' },
  { id: 'all', label: 'All' }
]

export default function Governance() {
  const address = useWallet((state) => state.address)
  const [filterId, setFilterId] = useState('all')
  const [openId, setOpenId] = useState<string | undefined>()

  const filter = FILTERS.find((f) => f.id === filterId) ?? FILTERS[2]
  const governance = useGovernance(filter.status)

  /*
   * Re-reading after a vote rather than patching the row locally: the tally
   * moves by the voter's whole delegated stake, and guessing that number on
   * the client would show a figure the chain never agreed to.
   */
  const actions = useGovernanceActions(() => governance.refresh())

  const selected = governance.proposals.find((p) => p.id === openId)

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <h1 className="text-display">Governance</h1>
        <div className="flex items-center gap-1 rounded-pill border border-border p-1">
          {FILTERS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={filterId === option.id}
              onClick={() => {
                setFilterId(option.id)
                setOpenId(undefined)
              }}
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

      <section className="flex flex-col gap-4">
        {governance.loading && governance.proposals.length === 0 ? (
          <div className="flex flex-col gap-2" aria-busy>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-control bg-surface" />
            ))}
          </div>
        ) : governance.proposals.length === 0 ? (
          <p className="px-2 py-10 text-center text-base text-text-muted">
            {filter.id === 'open'
              ? 'Nothing is open for voting right now.'
              : filter.id === 'deposit'
                ? 'No proposals are collecting deposits.'
                : 'No proposals found.'}
          </p>
        ) : (
          <ul className="flex flex-col">
            {governance.proposals.map((proposal) => (
              <ProposalRow
                key={proposal.id}
                proposal={proposal}
                tally={governance.tallies.get(proposal.id)}
                params={governance.params}
                bondedTokens={governance.bondedTokens}
                myVote={governance.myVotes.get(proposal.id)}
                onOpen={() => setOpenId(proposal.id)}
              />
            ))}
          </ul>
        )}

        {governance.hasMore ? (
          <div className="flex justify-center pt-2">
            <Button
              variant="soft"
              shape="control"
              size="sm"
              loading={governance.loadingMore}
              onClick={governance.loadMore}
            >
              Load older ({governance.proposals.length} of {governance.total})
            </Button>
          </div>
        ) : null}

        {governance.error ? (
          <p className="px-2 text-base text-text-muted" role="alert">
            Proposals could not be read: {governance.error}
          </p>
        ) : null}
      </section>

      {selected ? (
        <ProposalModal
          proposal={selected}
          tally={governance.tallies.get(selected.id)}
          params={governance.params}
          bondedTokens={governance.bondedTokens}
          myVote={governance.myVotes.get(selected.id)}
          connected={Boolean(address)}
          state={actions.state}
          onVote={(option) => void actions.vote(selected.id, option)}
          onClose={() => {
            setOpenId(undefined)
            actions.reset()
          }}
        />
      ) : null}
    </div>
  )
}

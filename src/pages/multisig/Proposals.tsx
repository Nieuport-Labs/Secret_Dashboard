import { FileSignature, Plus, Search, Upload } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import EmptyState from '@/components/ui/EmptyState'
import { cn } from '@/lib/cn'
import type { Envelope } from '@/lib/multisig/bundle'
import { fingerprintOf } from '@/lib/multisig/config'
import { describeMessage } from '@/lib/multisig/describe'
import { useMultisigProposals, useProposalsFor, type ProposalEntry } from '@/store/multisigProposals'
import { useActiveMultisigConfig, useMembership } from '@/store/multisig'
import { useWallet } from '@/store/wallet'
import { ImportBundle } from './components/BundleExchange'
import ProposalCard from './components/ProposalCard'
import { awaitsSignature, hasSigned } from '@/lib/multisig/stage'

/**
 * Every proposal this copy of the app knows about.
 *
 * "This copy" is the important part. There is no shared list — each member
 * holds their own, and two members' lists differing is the normal state of a
 * round in progress rather than a fault to reconcile. What matters is that
 * anything here can be checked from scratch, which is what the detail screen
 * does before it offers to sign.
 *
 * Laid out like the governance screen, because it answers the same question in
 * the same shape: a grid of cards, opening on the ones still live, with a
 * search and a filter for the archive. A group that votes on chain proposals
 * one week and on its own transactions the next should not have to learn two
 * screens to do it.
 */

const FILTERS: Array<{ id: string; label: string; match?: (entry: ProposalEntry) => boolean }> = [
  { id: 'open', label: 'Open', match: (entry) => !entry.receipt },
  { id: 'sent', label: 'Sent', match: (entry) => Boolean(entry.receipt) },
  { id: 'all', label: 'All' }
]

export default function Proposals() {
  const navigate = useNavigate()
  const config = useActiveMultisigConfig()
  const membership = useMembership(config)
  const walletAddress = useWallet((state) => state.address)
  const entries = useProposalsFor(config?.address)

  const upsert = useMultisigProposals((state) => state.upsert)
  const addSignature = useMultisigProposals((state) => state.addSignature)
  const recordBroadcast = useMultisigProposals((state) => state.recordBroadcast)
  const [importError, setImportError] = useState<string>()
  const [importing, setImporting] = useState(false)

  /*
   * Opens on what can still be acted on, not on the archive — the same choice
   * the governance screen makes, and for the same reason: anyone arriving is
   * far likelier to be asking whether anything needs signing than to be
   * reading what the group did last month.
   */
  const [filterId, setFilterId] = useState('open')
  const [query, setQuery] = useState('')

  const filter = FILTERS.find((entry) => entry.id === filterId) ?? FILTERS[2]

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()

    return entries.filter((entry) => {
      if (filter.match && !filter.match(entry)) return false
      if (!needle) return true

      // What a proposal does is as much its name as its title is — somebody
      // searching "unstake" is looking for the one that unstakes, whatever
      // whoever composed it decided to call it.
      const described = entry.proposal.msgs.map((message) => describeMessage(message).headline).join(' ')
      return (
        entry.proposal.title.toLowerCase().includes(needle) ||
        entry.proposal.note?.toLowerCase().includes(needle) ||
        described.toLowerCase().includes(needle)
      )
    })
  }, [entries, filter, query])

  const waiting = membership.isMember
    ? entries.filter((entry) => awaitsSignature(entry, walletAddress)).length
    : 0

  if (!config) return null

  /**
   * What arrives is filed, not believed.
   *
   * The only thing checked here is that it belongs to this account at all —
   * everything else is the detail screen's job, where there is room to say
   * what failed. A signature is stored unverified on purpose: the detail
   * screen shows each one's own verdict, and only verified ones are ever
   * assembled.
   */
  const accept = (envelope: Envelope) => {
    setImportError(undefined)

    if (envelope.fingerprint !== fingerprintOf(config)) {
      setImportError('That belongs to a different multisig — its member set does not match this account.')
      return
    }

    if (envelope.kind === 'proposal') {
      upsert(envelope)
      navigate(`/multisig/proposals/${envelope.id}`)
      return
    }

    if (envelope.kind === 'signature') {
      const known = entries.some((entry) => entry.proposal.id === envelope.proposalId)
      if (!known) {
        setImportError(
          'That is a signature for a proposal this browser has not seen. Import the proposal first.'
        )
        return
      }
      addSignature(envelope.proposalId, config.address, envelope)
      navigate(`/multisig/proposals/${envelope.proposalId}`)
      return
    }

    recordBroadcast(envelope)
    setImporting(false)
  }

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-7">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <h1 className="text-display">Proposals</h1>
        <div className="flex items-center gap-4">
          {waiting > 0 ? (
            <p className="text-base text-text-muted">
              <span className="font-medium text-accent">{waiting}</span> waiting for your signature
            </p>
          ) : null}
          {/*
            Importing is a button rather than a panel at the foot of the page.
            It is the answer to "somebody sent me one", which is a thing that
            happens to a member perhaps twice a round — not something that
            earns a permanent third of the screen under the list. It sits
            beside Propose because both answer the same question: how does a
            proposal get onto this screen.
          */}
          <Button
            variant="ghost"
            shape="control"
            size="sm"
            icon={<Upload size={15} aria-hidden />}
            onClick={() => {
              setImportError(undefined)
              setImporting(true)
            }}
          >
            Import
          </Button>

          <Button
            variant="soft"
            shape="control"
            size="sm"
            icon={<Plus size={16} aria-hidden />}
            onClick={() => navigate('/multisig/propose')}
            disabled={!membership.isMember}
          >
            Propose
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2.5 rounded-control border border-border bg-surface px-3 py-2 sm:max-w-sm">
          <Search size={16} aria-hidden className="shrink-0 text-text-muted" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
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
              onClick={() => setFilterId(option.id)}
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

      {entries.length === 0 ? (
        <EmptyState
          icon={FileSignature}
          title="Nothing proposed yet"
          description="A proposal is a transaction waiting for enough members to sign it. Compose one, or paste one you were sent."
        />
      ) : matches.length === 0 ? (
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <p className="text-base text-text-muted">
            {query.trim()
              ? `Nothing matches “${query.trim()}”.`
              : filter.id === 'open'
                ? 'Nothing is waiting for a signature.'
                : 'Nothing has been sent yet.'}
          </p>
          {!query.trim() ? (
            <Button variant="soft" shape="control" size="sm" onClick={() => setFilterId('all')}>
              Show all {entries.length}
            </Button>
          ) : null}
        </div>
      ) : (
        <ul className="grid items-stretch gap-4 lg:grid-cols-2">
          {matches.map((entry) => (
            <ProposalCard
              key={entry.proposal.id}
              entry={entry}
              threshold={config.threshold}
              signed={hasSigned(entry, walletAddress)}
              canSign={membership.isMember}
            />
          ))}
        </ul>
      )}

      <Modal
        open={importing}
        onClose={() => setImporting(false)}
        title="Bring one in"
        description="Paste what another member sent you — a proposal to review, or their signature for one you already have. Either form works: the line the clipboard carries, or the JSON in a file."
      >
        <ImportBundle onImport={accept} />
        {importError ? <p className="text-base text-negative">{importError}</p> : null}
      </Modal>
    </div>
  )
}

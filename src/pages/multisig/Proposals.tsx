import { FileSignature, Plus } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import Button from '@/components/ui/Button'
import EmptyState from '@/components/ui/EmptyState'
import { explorerTxUrl } from '@/chains/secret4'
import type { Envelope } from '@/lib/multisig/bundle'
import { fingerprintOf } from '@/lib/multisig/config'
import { useMultisigProposals, useProposalsFor, type ProposalEntry } from '@/store/multisigProposals'
import { useActiveMultisigConfig, useMembership } from '@/store/multisig'
import { ImportBundle } from './components/BundleExchange'

/**
 * Every proposal this copy of the app knows about.
 *
 * "This copy" is the important part. There is no shared list — each member
 * holds their own, and two members' lists differing is the normal state of a
 * round in progress rather than a fault to reconcile. What matters is that
 * anything here can be checked from scratch, which is what the detail screen
 * does before it offers to sign.
 */
export default function Proposals() {
  const navigate = useNavigate()
  const config = useActiveMultisigConfig()
  const membership = useMembership(config)
  const entries = useProposalsFor(config?.address)

  const upsert = useMultisigProposals((state) => state.upsert)
  const addSignature = useMultisigProposals((state) => state.addSignature)
  const recordBroadcast = useMultisigProposals((state) => state.recordBroadcast)
  const [importError, setImportError] = useState<string>()

  if (!config) return null

  /**
   * What arrives is filed, not believed.
   *
   * The only thing checked here is that it belongs to this account at all —
   * everything else is the detail screen's job, where there is room to say
   * what failed. A signature is stored unverified on purpose: the tray shows
   * each one's own verdict, and only verified ones are ever assembled.
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
  }

  return (
    <div className="mx-auto flex max-w-[860px] flex-col gap-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-display">Proposals</h1>
        <Button
          variant="soft"
          icon={<Plus size={16} />}
          onClick={() => navigate('/multisig/propose')}
          disabled={!membership.isMember}
        >
          Propose
        </Button>
      </header>

      {entries.length === 0 ? (
        <EmptyState
          icon={FileSignature}
          title="Nothing proposed yet"
          description="A proposal is a transaction waiting for enough members to sign it. Compose one, or paste one you were sent."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {entries.map((entry) => (
            <li key={entry.proposal.id}>
              <ProposalRow
                entry={entry}
                threshold={config.threshold}
                onOpen={() => navigate(`/multisig/proposals/${entry.proposal.id}`)}
              />
            </li>
          ))}
        </ul>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-title">Import</h2>
        <p className="text-base text-text-muted">
          Paste what another member sent you — a proposal to review, or their signature for one you already
          have.
        </p>
        <ImportBundle onImport={accept} />
        {importError ? <p className="text-base text-negative">{importError}</p> : null}
      </section>
    </div>
  )
}

function ProposalRow({
  entry,
  threshold,
  onOpen
}: {
  entry: ProposalEntry
  threshold: number
  onOpen: () => void
}) {
  const signatures = entry.signatures.length
  const status = entry.receipt
    ? entry.receipt.code === 0
      ? 'Broadcast'
      : `Failed (code ${entry.receipt.code})`
    : signatures >= threshold
      ? 'Ready to broadcast'
      : `${signatures} of ${threshold} signatures`

  return (
    <div className="flex items-center gap-3 rounded-card border border-border p-3">
      <button
        type="button"
        onClick={onOpen}
        className="state-layer flex min-w-0 flex-1 items-center gap-3 rounded-control p-1 text-left"
      >
        <FileSignature size={16} className="shrink-0 text-text-muted" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base">{entry.proposal.title}</span>
          <span className="text-label text-text-faint">
            {status} · sequence {entry.proposal.sequence}
          </span>
        </span>
      </button>

      {entry.receipt ? (
        <a
          href={explorerTxUrl(entry.receipt.txHash)}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 text-label text-accent"
        >
          View
        </a>
      ) : null}
    </div>
  )
}

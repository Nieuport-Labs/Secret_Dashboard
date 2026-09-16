import { AlertTriangle, ArrowLeft, Check, CircleSlash, PenLine, Send, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import Button from '@/components/ui/Button'
import { CHAIN_ID, DISPLAY_DENOM, explorerTxUrl } from '@/chains/secret4'
import { resolveLcdUrl } from '@/lib/endpoint'
import { errorMessage } from '@/lib/errors'
import { formatAmount, shortenAddress } from '@/lib/format'
import type { Envelope, Proposal, SignatureBundle } from '@/lib/multisig/bundle'
import { addressForPubkey, fingerprintOf } from '@/lib/multisig/config'
import {
  assembleProposal,
  broadcastProposal,
  rebuildProposal,
  signProposal,
  type Rebuilt
} from '@/lib/multisig/flow'
import {
  documentDigest,
  verifyCollected,
  verifyProposal,
  type Check as CheckRow
} from '@/lib/multisig/verify'
import { getProvider } from '@/lib/wallet'
import { useMultisigProposals, useProposalEntry } from '@/store/multisigProposals'
import { useActiveMultisigConfig, useMembership } from '@/store/multisig'
import { useSettings } from '@/store/settings'
import { useWallet } from '@/store/wallet'
import { ExportBundle, ImportBundle } from './components/BundleExchange'

/**
 * One proposal: what it does, whether it is safe, and what to do about it.
 *
 * Everything on this screen is produced locally. The transaction is rebuilt
 * from the proposal's declared intent rather than taken from it, the encrypted
 * messages are decrypted and compared against what the proposal claims, and
 * every signature is verified against the rebuilt document before it counts.
 * A proposal that fails any of that cannot be signed here at all — the button
 * is not merely discouraged, there is nothing to sign, because the transaction
 * could not be built.
 */
export default function MultisigProposal() {
  const { id } = useParams()
  const navigate = useNavigate()

  const config = useActiveMultisigConfig()
  const membership = useMembership(config)
  const entry = useProposalEntry(config?.address, id)
  const client = useWallet((state) => state.queryClient)
  const walletId = useWallet((state) => state.walletId)
  const walletAddress = useWallet((state) => state.address)
  const lcdOverride = useSettings((state) => state.lcdOverride)

  const addSignature = useMultisigProposals((state) => state.addSignature)
  const recordBroadcast = useMultisigProposals((state) => state.recordBroadcast)
  const discard = useMultisigProposals((state) => state.discard)

  const [review, setReview] = useState<Review>({ status: 'checking' })
  const [signatureChecks, setSignatureChecks] = useState<CheckRow[]>([])
  const [usable, setUsable] = useState<Map<string, Uint8Array>>(new Map())
  const [action, setAction] = useState<ActionState>({ kind: 'idle' })
  const [mine, setMine] = useState<SignatureBundle>()

  const proposal = entry?.proposal

  /**
   * Rebuild, then check. In that order and never the other way round: the
   * checklist describes a transaction, and until one has been built there is
   * nothing to describe.
   */
  const run = useCallback(async () => {
    if (!config || !proposal || !client) return
    setReview({ status: 'checking' })

    try {
      const lcdUrl = await resolveLcdUrl(lcdOverride)

      let rebuilt: Rebuilt | undefined
      let rebuildError: string | undefined
      try {
        rebuilt = await rebuildProposal(lcdUrl, proposal)
      } catch (caught) {
        rebuildError = errorMessage(caught)
      }

      const verification = await verifyProposal({
        config,
        proposal,
        client,
        lcdUrl,
        doc: rebuilt?.doc
      })

      setReview({
        status: 'done',
        rebuilt,
        rebuildError,
        checks: verification.checks,
        signable: verification.signable && Boolean(rebuilt),
        warnings: verification.warnings
      })
    } catch (caught) {
      setReview({ status: 'failed', message: errorMessage(caught) })
    }
  }, [config, proposal, client, lcdOverride])

  useEffect(() => {
    void run()
  }, [run])

  // The signatures are checked against the document this machine rebuilt, so
  // they are re-checked whenever that changes as well as when one arrives.
  const collected = entry?.signatures
  useEffect(() => {
    if (review.status !== 'done' || !review.rebuilt || !config || !collected) {
      setSignatureChecks([])
      setUsable(new Map())
      return
    }

    let cancelled = false
    void verifyCollected({ config, doc: review.rebuilt.doc, bundles: collected }).then((result) => {
      if (cancelled) return
      setSignatureChecks(result.checks)
      setUsable(result.byMember)
    })

    return () => {
      cancelled = true
    }
  }, [review, config, collected])

  if (!config) return null

  if (!proposal || !entry) {
    return (
      <div className="mx-auto flex max-w-[760px] flex-col gap-4">
        <p className="text-base text-text-muted">
          This browser has no copy of that proposal. Paste the one you were sent.
        </p>
        <Button variant="secondary" onClick={() => navigate('/multisig/proposals')}>
          Back to proposals
        </Button>
      </div>
    )
  }

  const sign = async () => {
    if (review.status !== 'done' || !review.rebuilt || !walletId || !walletAddress) return
    const provider = getProvider(walletId)
    if (!provider) return

    setAction({ kind: 'signing' })
    try {
      const bundle = await signProposal({
        provider,
        signer: walletAddress,
        proposal,
        doc: review.rebuilt.doc
      })
      addSignature(proposal.id, config.address, bundle)
      setMine(bundle)
      setAction({ kind: 'idle' })
    } catch (caught) {
      setAction({ kind: 'failed', message: errorMessage(caught) })
    }
  }

  const broadcast = async () => {
    if (review.status !== 'done' || !review.rebuilt) return
    setAction({ kind: 'broadcasting' })

    try {
      const txBytes = assembleProposal({
        config,
        proposal,
        bodyBytes: review.rebuilt.bodyBytes,
        signatures: usable
      })

      const lcdUrl = await resolveLcdUrl(lcdOverride)
      const tx = await broadcastProposal({ lcdUrl, chainId: CHAIN_ID, txBytes, seed: proposal.seed })

      recordBroadcast({
        v: 1,
        kind: 'broadcast',
        proposalId: proposal.id,
        fingerprint: fingerprintOf(config),
        txHash: tx.transactionHash,
        code: tx.code,
        height: tx.height,
        broadcastAt: Date.now()
      })

      setAction(
        tx.code === 0
          ? { kind: 'sent', hash: tx.transactionHash }
          : {
              kind: 'rejected',
              hash: tx.transactionHash,
              message: tx.rawLog || `The chain refused it (code ${tx.code}).`
            }
      )
    } catch (caught) {
      setAction({ kind: 'failed', message: errorMessage(caught) })
    }
  }

  const accept = (envelope: Envelope) => {
    if (envelope.kind !== 'signature' || envelope.proposalId !== proposal.id) {
      setAction({ kind: 'failed', message: 'That is not a signature for this proposal.' })
      return
    }
    addSignature(proposal.id, config.address, envelope)
  }

  const alreadySigned = entry.signatures.some(
    (bundle) => walletAddress && addressForPubkey(bundle.pubkey) === walletAddress
  )
  const enough = usable.size >= config.threshold

  return (
    <div className="mx-auto flex max-w-[860px] flex-col gap-8">
      <button
        type="button"
        onClick={() => navigate('/multisig/proposals')}
        className="flex w-fit items-center gap-1.5 text-base text-text-muted"
      >
        <ArrowLeft size={15} /> Proposals
      </button>

      <header className="flex flex-col gap-2">
        <h1 className="text-display">{proposal.title}</h1>
        {proposal.note ? <p className="text-base text-text-muted">{proposal.note}</p> : null}
        <p className="text-label text-text-faint">
          Proposed by {shortenAddress(proposal.proposer, 12, 6)} · sequence {proposal.sequence} · document{' '}
          {review.status === 'done' && review.rebuilt ? documentDigest(review.rebuilt.doc) : '—'}
        </p>
      </header>

      <WhatItDoes proposal={proposal} />

      <section className="flex flex-col gap-3">
        <h2 className="text-title">Checks</h2>
        {review.status === 'checking' ? (
          <p className="text-base text-text-muted">Rebuilding the transaction and checking it…</p>
        ) : review.status === 'failed' ? (
          <p className="text-base text-negative">{review.message}</p>
        ) : (
          <>
            {review.rebuildError ? (
              <p className="flex gap-2 rounded-card border border-border p-4 text-base text-negative">
                <X size={16} className="mt-0.5 shrink-0" />
                <span>
                  The transaction could not be rebuilt from this proposal, so there is nothing to sign.{' '}
                  {review.rebuildError}
                </span>
              </p>
            ) : null}
            <CheckList checks={review.checks} />
          </>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-title">Signatures</h2>
        <p className="text-base text-text-muted">
          {usable.size} of {config.threshold} needed
          {entry.signatures.length > usable.size ? ' — some did not verify' : ''}.
        </p>

        {signatureChecks.length > 0 ? <CheckList checks={signatureChecks} /> : null}

        <div className="flex flex-wrap gap-2">
          <Button
            icon={<PenLine size={16} />}
            onClick={sign}
            loading={action.kind === 'signing'}
            disabled={
              !membership.isMember ||
              alreadySigned ||
              review.status !== 'done' ||
              (review.status === 'done' && !review.signable)
            }
          >
            {alreadySigned ? 'You have signed' : 'Sign'}
          </Button>

          <Button
            variant="soft"
            icon={<Send size={16} />}
            onClick={broadcast}
            loading={action.kind === 'broadcasting'}
            disabled={!enough || Boolean(entry.receipt)}
          >
            Broadcast
          </Button>
        </div>

        {!membership.isMember ? (
          <p className="text-label text-text-faint">
            This wallet is not a member of the account, so it cannot sign — but anyone holding a threshold of
            signatures can broadcast.
          </p>
        ) : null}

        {action.kind === 'failed' ? <p className="text-base text-negative">{action.message}</p> : null}
        {action.kind === 'rejected' ? (
          <div className="flex flex-col gap-1">
            <p className="text-base text-negative">{action.message}</p>
            <a
              href={explorerTxUrl(action.hash)}
              target="_blank"
              rel="noreferrer"
              className="text-base text-accent"
            >
              See the transaction
            </a>
          </div>
        ) : null}
        {action.kind === 'sent' || entry.receipt?.code === 0 ? (
          <a
            href={explorerTxUrl(action.kind === 'sent' ? action.hash : entry.receipt!.txHash)}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 text-base text-positive"
          >
            <Check size={15} /> Broadcast — see it on the explorer
          </a>
        ) : null}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-title">Passing it on</h2>

        <div className="flex flex-col gap-2 rounded-card border border-border p-4">
          <span className="text-base">Send this proposal to the other members</span>
          <ExportBundle envelope={proposal} filename={`${proposal.id}.proposal.json`} />
        </div>

        {mine ? (
          <div className="flex flex-col gap-2 rounded-card border border-border p-4">
            <span className="text-base">Send your signature back</span>
            <ExportBundle envelope={mine} filename={`${proposal.id}.signature.json`} />
          </div>
        ) : null}

        <div className="flex flex-col gap-2 rounded-card border border-border p-4">
          <span className="text-base">Add a signature you were sent</span>
          <ImportBundle onImport={accept} label="Paste a signature" />
        </div>
      </section>

      <div>
        <Button
          variant="ghost"
          size="sm"
          icon={<CircleSlash size={15} />}
          onClick={() => {
            discard(config.address, proposal.id)
            navigate('/multisig/proposals')
          }}
        >
          Discard this copy
        </Button>
        <p className="mt-1 text-label text-text-faint">
          Local only. It does not withdraw the proposal — other members keep their copies, and a threshold of
          signatures can still be broadcast by any of them.
        </p>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */

type Review =
  | { status: 'checking' }
  | { status: 'failed'; message: string }
  | {
      status: 'done'
      rebuilt?: Rebuilt
      rebuildError?: string
      checks: CheckRow[]
      warnings: CheckRow[]
      signable: boolean
    }

type ActionState =
  | { kind: 'idle' }
  | { kind: 'signing' }
  | { kind: 'broadcasting' }
  | { kind: 'sent'; hash: string }
  | { kind: 'rejected'; hash: string; message: string }
  | { kind: 'failed'; message: string }

/**
 * The messages, in the open.
 *
 * Shown as the plaintext the proposal declares — which is only worth anything
 * because the checklist beside it proves that the encrypted message on the
 * wire says the same thing. Without that check this panel would be decoration,
 * and a dangerous kind: it would look like review.
 */
function WhatItDoes({ proposal }: { proposal: Proposal }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-title">What it does</h2>
      <ul className="flex flex-col gap-2">
        {proposal.msgs.map((message, index) => (
          <li key={index} className="flex flex-col gap-1.5 rounded-card border border-border p-3">
            <span className="text-label text-text-muted">
              {index + 1}. {message.template}
              {message.ciphertext ? ' · encrypted on the wire' : ''}
            </span>
            <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-sm text-text-muted">
              {JSON.stringify(message.content, null, 2)}
            </pre>
          </li>
        ))}
      </ul>
      <p className="text-label text-text-faint">
        Fee {formatAmount(proposal.fee.amount[0]?.amount ?? '0', { reveal: true })} {DISPLAY_DENOM} for{' '}
        {proposal.fee.gas} gas
        {proposal.fee.granter ? `, paid by ${shortenAddress(proposal.fee.granter, 10, 6)}` : ''}.
        {proposal.memo ? ` Memo: “${proposal.memo}”.` : ''}
      </p>
    </section>
  )
}

function CheckList({ checks }: { checks: CheckRow[] }) {
  return (
    <ul className="flex flex-col rounded-card border border-border">
      {checks.map((check) => (
        <li key={check.id} className="flex gap-2.5 border-b border-border px-4 py-3 last:border-b-0">
          <span className="mt-0.5 shrink-0">
            {check.status === 'pass' ? (
              <Check size={16} className="text-positive" />
            ) : check.status === 'warn' ? (
              <AlertTriangle size={16} className="text-accent" />
            ) : (
              <X size={16} className="text-negative" />
            )}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="text-base">{check.label}</span>
            {check.detail ? <span className="text-label text-text-faint">{check.detail}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  )
}

import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  CircleSlash,
  PenLine,
  Send,
  ShieldCheck,
  X
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import Button from '@/components/ui/Button'
import CollapsibleSection from '@/components/ui/CollapsibleSection'
import { CHAIN_ID, DISPLAY_DENOM, explorerAccountUrl, explorerTxUrl } from '@/chains/secret4'
import { publishEnvelope } from '@/hooks/useMultisigSync'
import { cn } from '@/lib/cn'
import { resolveLcdUrl } from '@/lib/endpoint'
import { errorMessage } from '@/lib/errors'
import { formatAmount, shortenAddress } from '@/lib/format'
import type { Envelope, Proposal, SignatureBundle } from '@/lib/multisig/bundle'
import { addressForPubkey, fingerprintOf, type MultisigConfig } from '@/lib/multisig/config'
import { validatorAddressesIn } from '@/lib/multisig/describe'
import { queryValidator } from '@/lib/staking'
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
import MessageCard from './components/MessageCard'
import { SignatureBar, StageBadge } from './components/ProposalCard'
import { ageLabel, stageOf } from '@/lib/multisig/stage'

/**
 * One proposal: what it does, and what to do about it.
 *
 * Built like a governance proposal's page, because it is the same object seen
 * from the inside — facts on the left, the decision on the right, and the
 * decision panel is where the state of the round lives.
 *
 * Everything here is produced locally. The transaction is rebuilt from the
 * proposal's declared intent rather than taken from it, the encrypted messages
 * are decrypted and compared against what the proposal claims, and every
 * signature is verified against the rebuilt document before it counts. A
 * proposal that fails any of that cannot be signed here at all — the button is
 * not merely discouraged, there is nothing to sign, because the transaction
 * could not be built.
 *
 * That work no longer has a section of its own. A list of green ticks is what
 * a checklist looks like when nothing is wrong, which is almost always, and a
 * wall of reassurance every time teaches people to scroll past the one time it
 * is not. So a clean review is one line, a failure is a card that cannot be
 * missed, and the itemised list is a click away for anyone who wants it.
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
   * verdict describes a transaction, and until one has been built there is
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
      void publishEnvelope(bundle)
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

      const receipt = {
        v: 1 as const,
        kind: 'broadcast' as const,
        proposalId: proposal.id,
        fingerprint: fingerprintOf(config),
        txHash: tx.transactionHash,
        code: tx.code,
        height: tx.height,
        broadcastAt: Date.now()
      }
      recordBroadcast(receipt)
      // So the others stop waiting for signatures on something already sent.
      void publishEnvelope(receipt)

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
  const stage = stageOf(entry, config.threshold)
  const failing =
    review.status === 'done' ? review.checks.filter((check) => check.status !== 'pass') : []

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-6">
      <Link
        to="/multisig/proposals"
        className="state-layer -ml-2 inline-flex w-fit items-center gap-2 rounded-pill px-2 py-1 text-base text-text-muted hover:text-text"
      >
        <ArrowLeft size={16} aria-hidden />
        Proposals
      </Link>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <StageBadge stage={stage} />
          {alreadySigned ? (
            <span className="inline-flex items-center gap-1 rounded-pill bg-accent-container px-2.5 py-0.5 text-label font-medium text-accent">
              <Check size={12} aria-hidden />
              You signed
            </span>
          ) : null}
          <span className="rounded-pill bg-surface px-2.5 py-0.5 text-label text-text-muted">
            {ageLabel(proposal.createdAt)}
          </span>
        </div>

        <h1 className="text-display">{proposal.title}</h1>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <section className="card flex flex-col gap-4 p-5">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Fact label="Proposed by">{shortenAddress(proposal.proposer, 10, 6, { reveal: true })}</Fact>
              <Fact label="Sequence">{proposal.sequence}</Fact>
              <Fact label="Fee">
                {formatAmount(proposal.fee.amount[0]?.amount ?? '0', { reveal: true })} {DISPLAY_DENOM}
              </Fact>
              {/*
                The fingerprint of the exact bytes every member signs. Two
                members reading the same sixteen characters aloud have
                established that their copies are the same document — which is
                the one thing about this screen that cannot be checked from
                inside it.
              */}
              <Fact label="Document">
                {review.status === 'done' && review.rebuilt ? documentDigest(review.rebuilt.doc) : '—'}
              </Fact>
            </div>
          </section>

          {proposal.note ? (
            <CollapsibleSection title="Why">
              <p className="whitespace-pre-wrap break-words text-base text-text-muted">{proposal.note}</p>
            </CollapsibleSection>
          ) : null}

          <WhatItDoes proposal={proposal} />

          {/*
            Trouble, when there is any. This is the part of the old checklist
            worth a section: a failed rebuild means there is nothing to sign at
            all, and a failed check means the proposal is not what it says it
            is. Neither is something to fold away.
          */}
          {review.status === 'failed' ? (
            <Alert tone="bad">{review.message}</Alert>
          ) : review.status === 'done' && review.rebuildError ? (
            <Alert tone="bad">
              The transaction could not be rebuilt from this proposal, so there is nothing to sign.{' '}
              {review.rebuildError}
            </Alert>
          ) : failing.length > 0 ? (
            <Alert tone={failing.some((check) => check.status === 'fail') ? 'bad' : 'warn'}>
              <ul className="flex flex-col gap-2">
                {failing.map((check) => (
                  <li key={check.id}>
                    <span className="block">{check.label}</span>
                    {check.detail ? (
                      <span className="block text-label text-text-faint">{check.detail}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Alert>
          ) : null}
        </div>

        <div className="flex flex-col gap-6">
          <section className="card flex flex-col gap-4 p-5">
            <h2 className="text-title">Signatures</h2>

            <SignatureBar
              collected={usable.size}
              threshold={config.threshold}
              done={Boolean(entry.receipt)}
            />

            {entry.signatures.length > usable.size && review.status === 'done' ? (
              <p className="text-label text-negative">
                {entry.signatures.length - usable.size} of the signatures received did not verify against this
                document and are not counted.
              </p>
            ) : null}

            <Members config={config} signed={usable} you={membership.member?.address} />

            <div className="flex flex-col gap-2">
              <Button
                block
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
                block
                variant="soft"
                icon={<Send size={16} />}
                onClick={broadcast}
                loading={action.kind === 'broadcasting'}
                disabled={!enough || Boolean(entry.receipt)}
              >
                Broadcast
              </Button>
            </div>

            <Verdict review={review} checks={signatureChecks} />

            {!membership.isMember ? (
              <p className="text-label text-text-faint">
                This wallet is not a member of the account, so it cannot sign — but anyone holding a threshold
                of signatures can broadcast.
              </p>
            ) : null}

            {action.kind === 'failed' ? <p className="text-base text-negative">{action.message}</p> : null}
            {action.kind === 'rejected' ? (
              <div className="flex flex-col gap-1">
                <p className="text-base text-negative">{action.message}</p>
                <a
                  href={explorerTxUrl(action.hash)}
                  target="_blank"
                  rel="noreferrer noopener"
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
                rel="noreferrer noopener"
                className="flex items-center gap-1.5 text-base text-positive"
              >
                <Check size={15} aria-hidden /> Broadcast — see it on the explorer
              </a>
            ) : null}
          </section>

          <section className="card flex flex-col gap-4 p-5">
            <h2 className="text-title">Passing it on</h2>

            <div className="flex flex-col gap-2">
              <span className="text-base text-text-muted">Send this proposal to the other members</span>
              <ExportBundle envelope={proposal} filename={`${proposal.id}.proposal.json`} />
            </div>

            {mine ? (
              <div className="flex flex-col gap-2">
                <span className="text-base text-text-muted">Send your signature back</span>
                <ExportBundle envelope={mine} filename={`${proposal.id}.signature.json`} />
              </div>
            ) : null}

            <div className="flex flex-col gap-2">
              <span className="text-base text-text-muted">Add a signature you were sent</span>
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
              Local only. It does not withdraw the proposal — other members keep their copies, and a threshold
              of signatures can still be broadcast by any of them.
            </p>
          </div>
        </div>
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

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-label text-text-faint">{label}</dt>
      <dd className="mt-0.5 truncate font-mono text-base text-text-muted" title={String(children)}>
        {children}
      </dd>
    </div>
  )
}

function Alert({ tone, children }: { tone: 'bad' | 'warn'; children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className={cn(
        'flex gap-2.5 rounded-card border border-border p-4 text-base',
        tone === 'bad' ? 'text-negative' : 'text-text-muted'
      )}
      // Tinted from the same token as the text, like the status badges — the
      // design tokens are full colours, not the bare channels an opacity
      // modifier would need.
      style={
        tone === 'bad'
          ? { borderColor: 'color-mix(in srgb, var(--color-negative) 45%, transparent)' }
          : undefined
      }
    >
      {tone === 'bad' ? (
        <X size={16} aria-hidden className="mt-0.5 shrink-0" />
      ) : (
        <AlertTriangle size={16} aria-hidden className="mt-0.5 shrink-0 text-accent" />
      )}
      <div className="min-w-0">{children}</div>
    </div>
  )
}

/**
 * The review, in one line — with the itemised version behind a disclosure.
 *
 * The list used to be a section of its own, a dozen rows of green ticks above
 * the button. It read as thoroughness and worked as noise: the same wall
 * appears whether everything is right or one thing is wrong, and a reader who
 * has scrolled past it four times does not read it the fifth. The sentence
 * carries the verdict, the alert on the left carries a failure, and anyone who
 * wants the rows can still have them.
 */
function Verdict({ review, checks }: { review: Review; checks: CheckRow[] }) {
  const [open, setOpen] = useState(false)

  if (review.status === 'checking') {
    return <p className="text-label text-text-muted">Rebuilding the transaction and checking it…</p>
  }

  if (review.status === 'failed') return null

  const all = [...review.checks, ...checks]
  const bad = all.filter((check) => check.status !== 'pass')

  return (
    <div className="flex flex-col gap-2">
      <p className="flex gap-2 text-label text-text-muted">
        {bad.length === 0 ? (
          <ShieldCheck size={14} aria-hidden className="mt-0.5 shrink-0 text-positive" />
        ) : (
          <AlertTriangle size={14} aria-hidden className="mt-0.5 shrink-0 text-accent" />
        )}
        <span>
          {bad.length === 0
            ? 'Rebuilt from this proposal, decrypted and matched against the chain. Every check passed.'
            : `${bad.length} of ${all.length} checks did not pass.`}
        </span>
      </p>

      <button
        type="button"
        onClick={() => setOpen((shown) => !shown)}
        aria-expanded={open}
        className="flex w-fit items-center gap-1 text-label text-text-faint"
      >
        <ChevronDown
          size={13}
          aria-hidden
          className={open ? 'rotate-180 transition-transform' : 'transition-transform'}
        />
        {open ? 'Hide what was checked' : 'What was checked'}
      </button>

      {open ? (
        <ul className="flex flex-col gap-1.5">
          {all.map((check) => (
            <li key={check.id} className="flex gap-2 text-label">
              <span className="mt-0.5 shrink-0">
                {check.status === 'pass' ? (
                  <Check size={13} className="text-positive" />
                ) : check.status === 'warn' ? (
                  <AlertTriangle size={13} className="text-accent" />
                ) : (
                  <X size={13} className="text-negative" />
                )}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-text-muted">{check.label}</span>
                {check.detail ? <span className="text-text-faint">{check.detail}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/**
 * Who has signed and who has not.
 *
 * The multisig's answer to the governance screen's validator votes: a round is
 * a small number of named people, and the useful question halfway through is
 * which of them is still being waited on. Only verified signatures count as
 * signed — one that did not verify is not a member who has signed, whatever it
 * claims.
 */
function Members({
  config,
  signed,
  you
}: {
  config: MultisigConfig
  signed: Map<string, Uint8Array>
  you?: string
}) {
  return (
    <ul className="flex flex-col gap-1.5">
      {config.members.map((member, index) => {
        const has = signed.has(member.address)
        return (
          <li key={member.pubkey} className="flex items-center gap-2 text-label">
            <span
              aria-hidden
              className={cn(
                'flex size-4 shrink-0 items-center justify-center rounded-pill',
                has ? 'bg-positive text-[var(--color-bg)]' : 'bg-surface'
              )}
            >
              {has ? <Check size={11} strokeWidth={3} /> : null}
            </span>
            <span className={cn('min-w-0 flex-1 truncate', has ? 'text-text' : 'text-text-faint')}>
              {member.label || `Member ${index + 1}`}
              {member.address === you ? <span className="ml-1.5 text-accent">you</span> : null}
            </span>
            <a
              href={explorerAccountUrl(member.address)}
              target="_blank"
              rel="noreferrer noopener"
              className="shrink-0 font-mono text-text-faint hover:text-text-muted"
              title={member.address}
            >
              {shortenAddress(member.address, 10, 4, { reveal: true })}
            </a>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * The messages, in the open.
 *
 * Shown as the plaintext the proposal declares — which is only worth anything
 * because the review beside it proves that the encrypted message on the wire
 * says the same thing. Without that check this panel would be decoration, and
 * a dangerous kind: it would look like review.
 */
function WhatItDoes({ proposal }: { proposal: Proposal }) {
  const client = useWallet((state) => state.queryClient)
  const [names, setNames] = useState<Map<string, string>>(new Map())

  /*
   * Validator names, looked up once for whatever this proposal mentions.
   *
   * "Stake 10 SCRT with Secret Saturn" is a sentence a member can check
   * against what the group actually agreed. A valoper address is not — two of
   * them differ in the middle and nobody notices. Failure is silent and the
   * address stands in, which is exactly as useful as before.
   */
  const mentioned = validatorAddressesIn(proposal.msgs).join(',')
  useEffect(() => {
    if (!client || !mentioned) return

    let cancelled = false
    void Promise.all(
      mentioned.split(',').map(async (address) => [address, await queryValidator(client, address)] as const)
    )
      .then((results) => {
        if (cancelled) return
        setNames(
          new Map(
            results
              .filter(([, validator]) => validator?.moniker)
              .map(([address, validator]) => [address, validator!.moniker])
          )
        )
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [client, mentioned])

  return (
    <CollapsibleSection title="What it does">
      <ul className="flex flex-col gap-2">
        {proposal.msgs.map((message, index) => (
          <MessageCard key={index} message={message} index={index} context={{ validatorNames: names }} />
        ))}
      </ul>
      <p className="mt-2 text-label text-text-faint">
        {proposal.fee.gas} gas
        {proposal.fee.granter ? `, paid by ${shortenAddress(proposal.fee.granter, 10, 6)}` : ''}.
        {proposal.memo ? ` Memo: “${proposal.memo}”.` : ''}
      </p>
    </CollapsibleSection>
  )
}

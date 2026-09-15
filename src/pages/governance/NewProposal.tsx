import { ArrowLeft, CheckCircle2, ExternalLink } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import Button from '@/components/ui/Button'
import CollapsibleSection from '@/components/ui/CollapsibleSection'
import Modal from '@/components/ui/Modal'
import { DECIMALS, DISPLAY_DENOM, GAS_PRICE_USCRT, explorerTxUrl } from '@/chains/secret4'
import { cn } from '@/lib/cn'
import { estimateFee, formatDisplayAmount, shortenAddress } from '@/lib/format'
import {
  DEPOSIT_FALLBACK,
  PROPOSAL_LIMITS,
  messageTypeLabel,
  queryGovParams,
  queryGovParamsJson,
  type GovParams
} from '@/lib/governance'
import {
  GOV_AUTHORITY,
  ProposalMessageError,
  encodeProposalMessages,
  type EncodedProposalMessage
} from '@/lib/proposalMessages'
import { PROPOSAL_TEMPLATES } from '@/lib/proposalTemplates'
import { useBalances } from '@/hooks/useBalances'
import { useSubmitProposal } from '@/hooks/useSubmitProposal'
import { useWallet } from '@/store/wallet'

/**
 * Writing a proposal and putting it on chain.
 *
 * Laid out as the proposal it will become: the same two columns as the detail
 * page, the writing on the left and the panel that acts on the right, so the
 * page someone drafts in and the page everyone else reads are recognisably the
 * same object.
 *
 * Two kinds, because only two are worth separating: a text proposal, which is a
 * question put to the voters and executes nothing, and one carrying messages
 * the chain runs itself if it passes. The second is written as JSON rather than
 * as a form per message type — there are dozens of those types, and a form that
 * knew five of them would be a wall in front of the other forty. The JSON is
 * exactly what the detail page already prints back for every proposal that
 * exists.
 *
 * The deposit is not a figure to choose. A proposal only reaches a vote once
 * the whole minimum is down, and anything less leaves it parked in the deposit
 * period hoping a stranger makes up the difference — so the track decides the
 * amount and the panel states it. Every number here is read from the chain's
 * own parameters, and the whole transaction can be rehearsed against a node
 * before it is paid for.
 */
export default function NewProposal() {
  const navigate = useNavigate()
  const queryClient = useWallet((state) => state.queryClient)
  const address = useWallet((state) => state.address)
  const balances = useBalances(undefined)
  const submission = useSubmitProposal()

  const titleId = useId()
  const summaryId = useId()
  const metadataId = useId()
  const messagesId = useId()

  const [params, setParams] = useState<GovParams | undefined>()
  /** The same parameters unparsed, which is what a parameter-change template
   *  has to carry — see `queryGovParamsJson`. */
  const [rawParams, setRawParams] = useState<Record<string, unknown> | undefined>()
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [metadata, setMetadata] = useState('')
  const [expedited, setExpedited] = useState(false)
  const [carriesMessages, setCarriesMessages] = useState(false)
  const [messagesJson, setMessagesJson] = useState('')
  const [encoded, setEncoded] = useState<EncodedProposalMessage[]>([])
  const [messagesError, setMessagesError] = useState<string | undefined>()
  const [confirming, setConfirming] = useState(false)

  /*
   * The parameters, read here rather than through `useGovernance`: that hook
   * loads the chain's entire proposal history, which this page has no use for.
   */
  useEffect(() => {
    if (!queryClient) return
    let live = true
    void queryGovParams(queryClient)
      .then((read) => {
        if (live) setParams(read)
      })
      .catch(() => undefined)
    void queryGovParamsJson(queryClient)
      .then((read) => {
        if (live) setRawParams(read)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [queryClient])

  /*
   * Encoded as the author types, because what that catches — a type URL the
   * chain does not know, a field protobuf quietly drops — is only fixable while
   * they are still looking at the JSON.
   */
  useEffect(() => {
    if (!carriesMessages || !messagesJson.trim()) {
      setEncoded([])
      setMessagesError(undefined)
      return
    }

    let live = true
    void encodeProposalMessages(messagesJson)
      .then((result) => {
        if (!live) return
        setEncoded(result)
        setMessagesError(undefined)
      })
      .catch((error: unknown) => {
        if (!live) return
        setEncoded([])
        setMessagesError(error instanceof ProposalMessageError ? error.message : String(error))
      })
    return () => {
      live = false
    }
  }, [carriesMessages, messagesJson])

  /** Any edit invalidates the rehearsal of the version before it. */
  useEffect(() => {
    submission.reset()
    // Everything the transaction is built from, and nothing else.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, summary, metadata, expedited, carriesMessages, messagesJson])

  const standardDeposit = params?.minDeposit ?? DEPOSIT_FALLBACK.standard
  const expeditedDeposit = params?.expeditedMinDeposit ?? DEPOSIT_FALLBACK.expedited
  /** The whole minimum for the chosen track — the deposit, not a starting bid. */
  const deposit = BigInt(expedited ? expeditedDeposit : standardDeposit)

  const available = balances.native ? BigInt(balances.native) : undefined
  const fee = BigInt(estimateFee(submission.gas, GAS_PRICE_USCRT))
  /*
   * Only the deposit is measured against the balance. The fee may well be paid
   * by someone else's grant, so folding it in would report an account short of
   * funds it does not need.
   */
  const short = available !== undefined && available < deposit

  const problems: string[] = []
  if (!title.trim()) problems.push('a title')
  if (!summary.trim()) problems.push('a description')
  if (carriesMessages && encoded.length === 0) problems.push('at least one message')

  const ready =
    Boolean(address) &&
    problems.length === 0 &&
    !short &&
    !messagesError &&
    title.length <= PROPOSAL_LIMITS.title &&
    summary.length <= PROPOSAL_LIMITS.summary &&
    metadata.length <= PROPOSAL_LIMITS.metadata

  const draft = {
    title: title.trim(),
    summary: summary.trim(),
    metadata: metadata.trim(),
    messages: carriesMessages ? encoded.map((message) => message.msg) : [],
    initialDeposit: deposit.toString(),
    expedited
  }

  const sending = submission.state.kind === 'sending'
  const executes = carriesMessages
    ? encoded.map((message) => messageTypeLabel(message.typeUrl)).join(', ')
    : undefined

  if (submission.state.kind === 'done') {
    return (
      <Receipt
        hash={submission.state.hash}
        proposalId={submission.proposalId}
        onOpen={(id) => navigate(`/governance/${id}`)}
      />
    )
  }

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
        {/* The pill the detail page opens with, saying what this one will be. */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-pill bg-surface px-2.5 py-0.5 text-label text-text-muted">Draft</span>
          {expedited ? (
            <span
              className="rounded-pill bg-surface px-2.5 py-0.5 text-label text-text-muted"
              title="Shorter voting period, higher threshold to pass"
            >
              Expedited
            </span>
          ) : null}
        </div>

        <h1 className="text-display">{title.trim() || 'New proposal'}</h1>
        <p className="text-base text-text-muted">
          Submitted to secret-4 itself. Everything written here becomes public and permanent the moment it is
          signed.
        </p>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <section className="card flex flex-col gap-5 p-5">
            <Field label="Title" id={titleId} count={[title.length, PROPOSAL_LIMITS.title]}>
              <input
                id={titleId}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={PROPOSAL_LIMITS.title}
                placeholder="What this proposal asks for"
                className="w-full rounded-control border border-border bg-surface px-3 py-2.5 text-base outline-none placeholder:text-text-faint focus:border-accent"
              />
            </Field>

            <Field
              label="Description"
              id={summaryId}
              count={[summary.length, PROPOSAL_LIMITS.summary]}
              hint="Plain text. Voters read it as written — no formatting is rendered, here or anywhere else."
            >
              <textarea
                id={summaryId}
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
                maxLength={PROPOSAL_LIMITS.summary}
                rows={12}
                placeholder="The case for it, in full."
                className="w-full resize-y rounded-control border border-border bg-surface px-3 py-2.5 text-base leading-relaxed outline-none placeholder:text-text-faint focus:border-accent"
              />
            </Field>

            <Field
              label="Metadata"
              id={metadataId}
              count={[metadata.length, PROPOSAL_LIMITS.metadata]}
              hint="Optional, and stored verbatim. Conventionally a link to the forum thread."
            >
              <input
                id={metadataId}
                value={metadata}
                onChange={(event) => setMetadata(event.target.value)}
                maxLength={PROPOSAL_LIMITS.metadata}
                placeholder="https://forum.scrt.network/…"
                className="w-full rounded-control border border-border bg-surface px-3 py-2.5 text-base outline-none placeholder:text-text-faint focus:border-accent"
              />
            </Field>
          </section>

          {/* The same section the detail page calls "Details", written instead
              of read. */}
          <CollapsibleSection
            title="Details"
            description="A text proposal records a decision and executes nothing. Messages are run by the chain itself, under its own authority, if the vote passes."
          >
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap gap-2">
                <Choice selected={!carriesMessages} onSelect={() => setCarriesMessages(false)}>
                  Text only
                </Choice>
                <Choice selected={carriesMessages} onSelect={() => setCarriesMessages(true)}>
                  Executes messages
                </Choice>
              </div>

              {carriesMessages ? (
                <>
                  {/*
                    Templates before the editor, because the field names are the
                    part nobody remembers. Each is a starting point that still
                    has to be edited — the treasury one has no recipient, the
                    upgrade no height — so none of them is signable as it lands.
                  */}
                  <div className="flex flex-col gap-2">
                    <span className="text-label text-text-muted">Start from</span>
                    <div className="flex flex-wrap gap-2">
                      {PROPOSAL_TEMPLATES.map((template) => (
                        <button
                          key={template.id}
                          type="button"
                          title={template.detail}
                          onClick={() => setMessagesJson(template.json(rawParams))}
                          className="state-layer rounded-pill border border-border px-3 py-1.5 text-sm font-medium text-text-muted transition-colors duration-[var(--duration-short)] ease-[var(--ease-standard)] hover:text-text"
                        >
                          {template.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <Field
                    label="Messages"
                    id={messagesId}
                    hint={`One message object or an array of them, in the same JSON the chain prints on any proposal. The authority is almost always the gov account, ${GOV_AUTHORITY}.`}
                  >
                    <textarea
                      id={messagesId}
                      value={messagesJson}
                      onChange={(event) => setMessagesJson(event.target.value)}
                      rows={10}
                      spellCheck={false}
                      placeholder={'[{ "@type": "/cosmos.bank.v1beta1.MsgSend", … }]'}
                      className="w-full resize-y rounded-control border border-border bg-surface px-3 py-2.5 font-mono text-sm outline-none placeholder:text-text-faint focus:border-accent"
                    />
                  </Field>

                  {/*
                    Compute messages are the one gap, and saying so here is
                    cheaper than letting someone write one out and then be
                    refused with no idea why.
                  */}
                  <span className="text-label text-text-faint">
                    Contract messages cannot be written here — their payload has to be encrypted.
                  </span>

                  {messagesError ? (
                    <p className="break-words text-base text-negative" role="alert">
                      {messagesError}
                    </p>
                  ) : null}

                  {/*
                    Shown in the same card the detail page gives a proposal's
                    messages, because that is what these will be read as.
                  */}
                  {encoded.map((message, index) => (
                    <div key={index} className="card flex flex-col gap-3 p-4">
                      <span className="w-fit rounded-pill bg-surface px-2.5 py-0.5 text-label text-text-muted">
                        {messageTypeLabel(message.typeUrl)}
                      </span>
                      <pre className="overflow-x-auto text-sm text-text-muted">
                        {JSON.stringify(message.decoded, null, 2)}
                      </pre>
                      {index === encoded.length - 1 ? (
                        <p className="text-label text-text-faint">
                          Decoded back out of the bytes that will be signed. Anything missing here was not
                          understood and will not be sent.
                        </p>
                      ) : null}
                    </div>
                  ))}
                </>
              ) : null}
            </div>
          </CollapsibleSection>
        </div>

        {/*
          The panel, in the slot and the shape the detail page votes from. One
          card rather than three: choosing the track, seeing what it costs and
          signing for it are one decision taken once.
        */}
        <section className="card flex flex-col gap-4 p-5">
          <h2 className="text-title">Track and deposit</h2>

          <div className="grid gap-2">
            <Choice selected={!expedited} onSelect={() => setExpedited(false)} wide>
              <span className="text-body font-medium">
                {formatDisplayAmount(standardDeposit, DECIMALS, { reveal: true })} {DISPLAY_DENOM}
              </span>
              <span className="text-label text-text-faint">
                Standard · {duration(params?.votingPeriod)} of voting
              </span>
            </Choice>
            <Choice selected={expedited} onSelect={() => setExpedited(true)} wide>
              <span className="text-body font-medium">
                {formatDisplayAmount(expeditedDeposit, DECIMALS, { reveal: true })} {DISPLAY_DENOM}
              </span>
              <span className="text-label text-text-faint">
                Expedited · {duration(params?.expeditedVotingPeriod)},{' '}
                {((params?.expeditedThreshold ?? 0.667) * 100).toFixed(0)}% to pass
              </span>
            </Choice>
          </div>

          <p className="text-label text-text-faint">
            The deposit is the whole minimum for the track, because anything less does not reach a vote. It
            comes back when voting closes, unless the proposal is vetoed — then the chain burns it.
          </p>

          {short ? (
            <p className="text-base text-negative" role="alert">
              This account holds {formatDisplayAmount(available ?? 0n)} {DISPLAY_DENOM}, less than the
              deposit.
            </p>
          ) : null}

          <div className="flex flex-col gap-2 border-t border-border pt-4">
            <Button
              variant="soft"
              block
              loading={submission.dryRun.kind === 'running'}
              disabled={!ready || sending}
              onClick={() => void submission.check(draft)}
            >
              Rehearse against a node
            </Button>

            <Button block disabled={!ready || sending} loading={sending} onClick={() => setConfirming(true)}>
              {address ? 'Submit proposal' : 'Connect a wallet to submit'}
            </Button>
          </div>

          {submission.dryRun.kind === 'ok' ? (
            <p className="flex items-center gap-2 text-base text-positive" role="status">
              <CheckCircle2 size={14} aria-hidden />
              The chain accepts it — {submission.dryRun.gasUsed.toLocaleString()} gas.
            </p>
          ) : null}
          {submission.dryRun.kind === 'failed' ? (
            <p className="break-words text-base text-negative" role="alert">
              {submission.dryRun.message}
            </p>
          ) : null}
          {submission.state.kind === 'failed' ? (
            <p className="break-words text-base text-negative" role="alert">
              {submission.state.message}
            </p>
          ) : null}

          <p className="text-label text-text-faint">
            {problems.length > 0 && address
              ? `Still needs ${problems.join(', ')}.`
              : `A rehearsal costs nothing and signs nothing. Submitting costs about ${formatDisplayAmount(fee, DECIMALS, { reveal: true })} ${DISPLAY_DENOM} in fees on top of the deposit.`}
          </p>
        </section>
      </div>

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Submit this proposal?"
        description="Signing puts it on chain under this account. Neither that nor the deposit can be undone."
      >
        {/*
          Said as a sentence rather than as a field table. There are four things
          to check and they read as one thought — what is being proposed, how
          fast, what it will do, and what leaves the account for it.
        */}
        <p className="text-base leading-relaxed text-text-muted">
          <span className="text-text">“{title.trim()}”</span> goes to the{' '}
          {expedited ? 'expedited' : 'standard'} track,{' '}
          {duration(expedited ? params?.expeditedVotingPeriod : params?.votingPeriod)} of voting,{' '}
          {executes ? `executing ${executes}` : 'executing nothing'}.{' '}
          <span className="text-text">
            {formatDisplayAmount(deposit, DECIMALS, { reveal: true })} {DISPLAY_DENOM}
          </span>{' '}
          leaves{' '}
          {submission.proposer
            ? shortenAddress(submission.proposer, 12, 6, { reveal: true })
            : 'this account'}{' '}
          as the deposit.
        </p>

        <Button
          block
          loading={sending}
          disabled={!ready}
          onClick={() => {
            setConfirming(false)
            void submission.submit(draft)
          }}
        >
          Sign and submit
        </Button>
      </Modal>
    </div>
  )
}

/** `604800` → `7 days`, for a chain parameter written in seconds. */
function duration(seconds: number | undefined): string {
  if (!seconds || seconds <= 0) return 'a week'
  const hours = Math.round(seconds / 3600)
  if (hours < 48) return `${hours} hours`
  return `${Math.round(hours / 24)} days`
}

function Field({
  label,
  id,
  hint,
  count,
  children
}: {
  label: string
  id: string
  hint?: string
  count?: [number, number]
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-4">
        <label htmlFor={id} className="text-label text-text-muted">
          {label}
        </label>
        {/* Only once it is close enough to matter — a counter reading 3 of
            10,200 is noise over every field it sits on. */}
        {count && count[0] > count[1] * 0.8 ? (
          <span className="shrink-0 text-label tabular-nums text-text-faint">
            {count[0]} / {count[1]}
          </span>
        ) : null}
      </div>
      {children}
      {hint ? <p className="text-label text-text-faint">{hint}</p> : null}
    </div>
  )
}

/** The option button the vote panel uses, for a choice made the same way. */
function Choice({
  selected,
  onSelect,
  wide = false,
  children
}: {
  selected: boolean
  onSelect: () => void
  /** Fills its column, for the stacked pair in the panel. */
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        'state-layer flex flex-col items-start gap-0.5 rounded-control border px-3.5 py-2.5 text-base font-medium',
        'transition-colors duration-[var(--duration-short)] ease-[var(--ease-standard)]',
        wide && 'w-full',
        selected ? 'border-transparent bg-accent-container text-accent' : 'border-border text-text-muted'
      )}
    >
      {children}
    </button>
  )
}

/** What happened, and where the proposal now lives. */
function Receipt({
  hash,
  proposalId,
  onOpen
}: {
  hash: string
  proposalId?: string
  onOpen: (id: string) => void
}) {
  return (
    <div className="mx-auto flex max-w-[640px] flex-col items-center gap-5 py-16 text-center">
      <CheckCircle2 size={40} aria-hidden className="text-positive" />
      <h1 className="text-display">
        {proposalId ? `Proposal #${proposalId} is on chain` : 'Proposal submitted'}
      </h1>

      {/* The deposit was the full minimum, so there is no deposit period to
          wait out — it went straight to a vote. */}
      <p className="text-base text-text-muted">Voting is open on it now.</p>

      <div className="flex flex-wrap justify-center gap-3">
        {proposalId ? (
          <Button shape="control" onClick={() => onOpen(proposalId)}>
            Open it
          </Button>
        ) : null}
        <a
          href={explorerTxUrl(hash)}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1.5 text-base text-accent hover:underline"
        >
          View the transaction
          <ExternalLink size={12} aria-hidden />
        </a>
      </div>
    </div>
  )
}

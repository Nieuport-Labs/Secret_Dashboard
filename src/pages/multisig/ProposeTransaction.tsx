import {
  ArrowLeft,
  Coins,
  Eye,
  FileCode,
  Gift,
  Landmark,
  Lock,
  LockOpen,
  Send,
  Shuffle,
  TrendingDown,
  TrendingUp,
  XCircle,
  type LucideIcon
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import Button from '@/components/ui/Button'
import { DISPLAY_DENOM, GAS_PRICE_USCRT } from '@/chains/secret4'
import { publishEnvelope } from '@/hooks/useMultisigSync'
import { resolveLcdUrl } from '@/lib/endpoint'
import { errorMessage } from '@/lib/errors'
import { estimateFee, formatAmount } from '@/lib/format'
import { composeProposal } from '@/lib/multisig/flow'
import { defaultGasFor, foreignSigners, type DeclaredMsg } from '@/lib/multisig/messages'
import { useMultisigProposals } from '@/store/multisigProposals'
import { useActiveMultisigConfig, useMembership } from '@/store/multisig'
import { useSettings } from '@/store/settings'
import { useViewingKeys } from '@/store/viewingKeys'
import { useWallet } from '@/store/wallet'
import AdvancedMessages from './components/AdvancedMessages'
import { toDeclared, type Row } from './components/advancedRows'
import MessageCard from './components/MessageCard'
import ProposalForm, { type ActionKind } from './components/ProposalForms'

/**
 * Composing a transaction for the group to sign.
 *
 * Arranged around the question a person actually arrives with — "what should
 * we do?" — rather than around the chain's message types. Each answer is a
 * form asking for the two or three things that answer needs, because a field
 * labelled "Amount" with SCRT beside it cannot be got wrong the way
 * `"amount": "10000000uscrt"` can: the base units, the denomination spelling
 * and the field names are the app's problem, not the proposer's.
 *
 * Under Advanced the JSON editor is unchanged, and remains the only route to a
 * contract this app has no form for. What it no longer is, is the price of
 * doing something ordinary.
 *
 * Whatever is composed is previewed through exactly the component the
 * reviewers will see it through. That is deliberate: an author who does not
 * recognise their own proposal in the preview has filled the form in wrong,
 * and finding that here costs nothing, while finding it mid-round costs
 * everybody's time and a sequence.
 */

interface Action {
  kind: ActionKind | 'advanced'
  label: string
  description: string
  icon: LucideIcon
}

const ACTIONS: Action[] = [
  { kind: 'send', label: 'Send', description: `${DISPLAY_DENOM} or a token, to any address`, icon: Send },
  { kind: 'wrap', label: 'Wrap', description: `Make ${DISPLAY_DENOM} private`, icon: Lock },
  { kind: 'unwrap', label: 'Unwrap', description: `Back to public ${DISPLAY_DENOM}`, icon: LockOpen },
  { kind: 'stake', label: 'Stake', description: 'Delegate to a validator', icon: TrendingUp },
  { kind: 'unstake', label: 'Unstake', description: 'Begin the 21-day unbonding', icon: TrendingDown },
  { kind: 'redelegate', label: 'Move stake', description: 'From one validator to another', icon: Shuffle },
  { kind: 'claim', label: 'Claim rewards', description: 'Collect what staking earned', icon: Coins },
  { kind: 'vote', label: 'Vote', description: 'On a governance proposal', icon: Landmark },
  { kind: 'viewing-key', label: 'Viewing key', description: 'So members can read balances', icon: Eye },
  { kind: 'fee-grant', label: 'Pay fees', description: 'Cover another account’s gas', icon: Gift },
  { kind: 'fee-revoke', label: 'Stop paying fees', description: 'Cancel an allowance', icon: XCircle },
  { kind: 'advanced', label: 'Advanced', description: 'Write the messages yourself', icon: FileCode }
]

export default function ProposeTransaction() {
  const navigate = useNavigate()
  const location = useLocation()
  const handed = (location.state ?? null) as { preset?: string; proposalId?: string; option?: string } | null

  const config = useActiveMultisigConfig()
  const membership = useMembership(config)
  const client = useWallet((state) => state.queryClient)
  const walletAddress = useWallet((state) => state.address)
  const lcdOverride = useSettings((state) => state.lcdOverride)
  const upsert = useMultisigProposals((state) => state.upsert)
  const setViewingKey = useViewingKeys((state) => state.setKey)
  const recordContracts = useViewingKeys((state) => state.recordContracts)

  /** Arriving from the governance screen or the overview picks the form. */
  const [action, setAction] = useState<Action['kind'] | undefined>(
    handed?.preset === 'vote' ? 'vote' : handed?.preset === 'viewing-key' ? 'viewing-key' : undefined
  )

  const [fromForm, setFromForm] = useState<DeclaredMsg[]>([])
  const [rows, setRows] = useState<Row[]>([{ id: 0, content: '' }])
  const [title, setTitle] = useState('')
  const [suggested, setSuggested] = useState('')
  const [note, setNote] = useState('')
  const [memo, setMemo] = useState('')
  const [granter, setGranter] = useState('')
  const [gas, setGas] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const advanced = action === 'advanced'
  const declared = useMemo(() => (advanced ? toDeclared(rows) : fromForm), [advanced, rows, fromForm])

  const gasDefault = config ? defaultGasFor(declared, config.members.length, config.threshold) : 0
  const gasLimit = Number(gas) || gasDefault

  const account = config?.address
  const foreign = useMemo(() => {
    if (!account || declared.length === 0) return []
    try {
      return foreignSigners(declared, account)
    } catch {
      // A half-filled message names nobody yet, which is not a mistake while
      // somebody is still typing it.
      return []
    }
  }, [declared, account])

  if (!config) return null

  const propose = async () => {
    if (!client || !walletAddress) return
    setBusy(true)
    setError(undefined)

    try {
      const lcdUrl = await resolveLcdUrl(lcdOverride)
      const proposal = await composeProposal({
        client,
        lcdUrl,
        config,
        proposer: walletAddress,
        title: (title.trim() || suggested).trim() || 'Untitled proposal',
        note: note.trim() || undefined,
        messages: declared,
        memo: memo.trim(),
        gasLimit,
        granter: granter.trim() || undefined
      })

      upsert(proposal)
      // Straight out to the other members, if the group has a connection. Not
      // waited on and not reported: the proposal is saved either way, and its
      // own screen offers the clipboard regardless.
      void publishEnvelope(proposal)

      rememberViewingKey(config.address, declared, setViewingKey, recordContracts)

      navigate(`/multisig/proposals/${proposal.id}`)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  const ready =
    membership.isMember &&
    declared.length > 0 &&
    foreign.length === 0 &&
    (!advanced || rows.every((row) => !row.error))

  return (
    <div className="mx-auto flex max-w-[860px] flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-display">Propose</h1>
        <p className="text-base text-text-muted">
          A transaction for {config.label} to sign. Nothing is sent until {config.threshold} of{' '}
          {config.members.length} members have signed it.
        </p>
      </header>

      {action === undefined ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-title">What should the group do?</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {ACTIONS.map((entry) => (
              <li key={entry.kind}>
                <button
                  type="button"
                  onClick={() => setAction(entry.kind)}
                  className="state-layer flex w-full items-start gap-3 rounded-card border border-border p-4 text-left"
                >
                  <span
                    aria-hidden
                    className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-pill bg-accent-container text-accent"
                  >
                    <entry.icon size={16} strokeWidth={1.75} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-base font-medium">{entry.label}</span>
                    <span className="block text-label text-text-muted">{entry.description}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <>
          <button
            type="button"
            onClick={() => {
              setAction(undefined)
              setFromForm([])
              setSuggested('')
            }}
            className="flex w-fit items-center gap-1.5 text-base text-text-muted"
          >
            <ArrowLeft size={15} /> Something else
          </button>

          <section className="flex flex-col gap-4">
            <h2 className="text-title">{ACTIONS.find((entry) => entry.kind === action)?.label}</h2>

            {advanced ? (
              <AdvancedMessages rows={rows} onRows={setRows} sender={config.address} />
            ) : (
              <ProposalForm
                kind={action as ActionKind}
                config={config}
                onMessages={setFromForm}
                onSuggestTitle={setSuggested}
                initial={{ proposalId: handed?.proposalId, option: handed?.option }}
              />
            )}

            {foreign.length > 0 ? (
              <p className="text-base text-negative">
                Message {foreign[0].index + 1} acts for {foreign[0].signer}, not for this account. The chain
                would refuse it however many members signed.
              </p>
            ) : null}
          </section>

          {declared.length > 0 ? (
            <section className="flex flex-col gap-3">
              <h2 className="text-title">What the others will see</h2>
              <ul className="flex flex-col gap-2">
                {declared.map((message, index) => (
                  <MessageCard key={index} message={message} index={index} />
                ))}
              </ul>
            </section>
          ) : null}

          <section className="flex flex-col gap-3">
            <h2 className="text-title">Details</h2>

            <label className="flex flex-col gap-1.5">
              <span className="text-label text-text-muted">What to call it</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={suggested || 'Pay the auditor'}
                className="rounded-control border border-border bg-surface px-3 py-2 text-base outline-none focus:border-accent"
              />
              <span className="text-label text-text-faint">
                {suggested && !title.trim()
                  ? `Left empty it will be called “${suggested}”.`
                  : 'For the other members. It travels with the proposal, not in the transaction.'}
              </span>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-label text-text-muted">Why (optional)</span>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={2}
                className="rounded-control border border-border bg-surface px-3 py-2 text-base outline-none focus:border-accent"
              />
            </label>

            <details className="rounded-card border border-border p-4">
              <summary className="cursor-pointer text-base text-text-muted">Fee, memo and who pays</summary>
              <div className="mt-3 flex flex-col gap-3">
                <label className="flex flex-col gap-1.5">
                  <span className="text-label text-text-muted">Memo (optional, public)</span>
                  <input
                    value={memo}
                    onChange={(event) => setMemo(event.target.value)}
                    maxLength={256}
                    className="rounded-control border border-border bg-surface px-3 py-2 text-base outline-none focus:border-accent"
                  />
                </label>

                <label className="flex flex-col gap-1.5">
                  <span className="text-label text-text-muted">Gas</span>
                  <input
                    value={gas}
                    onChange={(event) => setGas(event.target.value.replace(/[^0-9]/g, ''))}
                    placeholder={String(gasDefault)}
                    inputMode="numeric"
                    className="w-40 rounded-control border border-border bg-surface px-3 py-2 text-base outline-none focus:border-accent"
                  />
                  <span className="text-label text-text-faint">
                    Fee {formatAmount(estimateFee(gasLimit, GAS_PRICE_USCRT), { reveal: true })}{' '}
                    {DISPLAY_DENOM}. A contract call cannot be simulated on Secret, so this is an estimate. A
                    transaction that runs out of gas costs the fee and the whole round of signatures with it,
                    because the sequence is spent either way — so err upwards.
                  </span>
                </label>

                <label className="flex flex-col gap-1.5">
                  <span className="text-label text-text-muted">Paid by (optional)</span>
                  <input
                    value={granter}
                    onChange={(event) => setGranter(event.target.value)}
                    placeholder="An account that granted this one a fee allowance"
                    spellCheck={false}
                    className="rounded-control border border-border bg-surface px-3 py-2 font-mono text-sm outline-none focus:border-accent"
                  />
                  <span className="text-label text-text-faint">
                    The granter is part of what everyone signs, so it cannot be added or changed afterwards.
                  </span>
                </label>
              </div>
            </details>
          </section>

          {error ? <p className="text-base text-negative">{error}</p> : null}

          <div className="flex justify-end">
            <Button onClick={propose} disabled={!ready} loading={busy}>
              Create the proposal
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

/**
 * Note the viewing key a proposal is about to set.
 *
 * Read back out of the messages rather than taken from the form, so that the
 * Advanced route records it too and there is one definition of "the key this
 * account is getting". Recorded before the transaction lands, because the
 * proposal is where the key lives: every member decrypts it to check the
 * proposal in the first place.
 */
function rememberViewingKey(
  account: string,
  messages: DeclaredMsg[],
  setKey: (owner: string, key: string) => void,
  recordContracts: (owner: string, contracts: string[]) => void
): void {
  const contracts: string[] = []
  let key: string | undefined

  for (const message of messages) {
    if (message.template !== 'MsgExecuteContract') continue
    const inner = message.content.msg as { set_viewing_key?: { key?: string } } | undefined
    if (!inner?.set_viewing_key?.key) continue

    key = inner.set_viewing_key.key
    contracts.push(String(message.content.contract_address ?? ''))
  }

  if (!key || contracts.length === 0) return
  setKey(account, key)
  recordContracts(account, contracts.filter(Boolean))
}

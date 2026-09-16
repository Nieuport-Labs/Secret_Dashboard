import { Eye, Plus, Send, Trash2 } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import Button from '@/components/ui/Button'
import Picker from '@/components/ui/Picker'
import { DENOM, DISPLAY_DENOM, GAS_PRICE_USCRT } from '@/chains/secret4'
import { errorMessage } from '@/lib/errors'
import { estimateFee, formatAmount } from '@/lib/format'
import { MESSAGE_TEMPLATES } from '@/lib/messageTemplates'
import { publishEnvelope } from '@/hooks/useMultisigSync'
import { composeProposal } from '@/lib/multisig/flow'
import { defaultGasFor, foreignSigners, type DeclaredMsg } from '@/lib/multisig/messages'
import { generateViewingKey } from '@/lib/snip20'
import { resolveLcdUrl } from '@/lib/endpoint'
import { useMultisigProposals } from '@/store/multisigProposals'
import { useActiveMultisigConfig, useMembership } from '@/store/multisig'
import { useSettings } from '@/store/settings'
import { useViewingKeys } from '@/store/viewingKeys'
import { useWallet } from '@/store/wallet'
import { SSCRT_ADDRESS, allTokens } from '@/tokens/registry'

/**
 * Composing a transaction for the group to sign.
 *
 * The same JSON-and-templates approach Powertools uses, for the same reason:
 * whatever the chain can be asked to do, a group should be able to propose,
 * and a form per message type would cover a tenth of it. What is different
 * here is that nothing is sent — the result is a document that goes to the
 * other members, and the checks that matter happen on their screens, where
 * they can see the proposal rather than having written it.
 *
 * Two shortcuts sit on top, because they are what a new group actually does
 * first: send something, and set a viewing key so everyone can see what the
 * account holds.
 */
export default function ProposeTransaction() {
  const navigate = useNavigate()
  const location = useLocation()
  const handed = (location.state ?? null) as {
    preset?: string
    proposalId?: string
    option?: string
  } | null
  const preset = handed?.preset

  const config = useActiveMultisigConfig()
  const membership = useMembership(config)
  const client = useWallet((state) => state.queryClient)
  const walletAddress = useWallet((state) => state.address)
  const lcdOverride = useSettings((state) => state.lcdOverride)
  const upsert = useMultisigProposals((state) => state.upsert)
  const setViewingKey = useViewingKeys((state) => state.setKey)
  const recordContracts = useViewingKeys((state) => state.recordContracts)

  const nextId = useRef(1)
  const [title, setTitle] = useState(() =>
    preset === 'vote' && handed?.proposalId
      ? `Vote ${String(handed.option ?? '')} on proposal ${handed.proposalId}`
      : ''
  )
  const [note, setNote] = useState('')
  const [memo, setMemo] = useState('')
  const [granter, setGranter] = useState('')
  const [rows, setRows] = useState<Row[]>(() => initialRows(handed, config?.address))
  const [gas, setGas] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  /** The key this proposal would set, made once so a re-render does not change it. */
  const pendingKey = useRef(generateViewingKey())

  const declared = useMemo(() => toDeclared(rows), [rows])

  const gasDefault = config ? defaultGasFor(declared, config.members.length, config.threshold) : 0
  const gasLimit = Number(gas) || gasDefault

  const account = config?.address
  const foreign = useMemo(() => {
    if (!account || declared.length === 0) return []
    try {
      return foreignSigners(declared, account)
    } catch {
      // A message too incomplete to name its signer is not a mistake yet — the
      // person is still typing it.
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
        title: title.trim() || 'Untitled proposal',
        note: note.trim() || undefined,
        messages: declared,
        memo: memo.trim(),
        gasLimit,
        granter: granter.trim() || undefined
      })

      upsert(proposal)

      // Straight out to the other members, if the group has a connection. It
      // is not waited on and not reported: the proposal is saved either way,
      // and its own screen offers the clipboard regardless.
      void publishEnvelope(proposal)

      // A viewing key is only useful if every member ends up holding it, and
      // the proposal is what carries it: it is inside the encrypted message
      // each of them decrypts to check the proposal. Recording it here saves
      // the proposer from pasting it back in later.
      const keyed = declared
        .filter((message) => isViewingKeyMessage(message))
        .map((message) => String(message.content.contract_address))
      if (keyed.length > 0) {
        setViewingKey(config.address, pendingKey.current)
        recordContracts(config.address, keyed)
      }

      navigate(`/multisig/proposals/${proposal.id}`)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  const ready =
    membership.isMember && declared.length > 0 && foreign.length === 0 && rows.every((row) => !row.error)

  return (
    <div className="mx-auto flex max-w-[860px] flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-display">Propose</h1>
        <p className="text-base text-text-muted">
          A transaction for {config.label} to sign. Nothing is sent until {config.threshold} of{' '}
          {config.members.length} members have signed it.
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          icon={<Send size={15} />}
          onClick={() => {
            setTitle(`Send ${DISPLAY_DENOM}`)
            setRows([sendRow(nextId.current++, config.address)])
          }}
        >
          Send {DISPLAY_DENOM}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          icon={<Eye size={15} />}
          onClick={() => {
            setTitle('Set a viewing key')
            setRows([viewingKeyRow(nextId.current++, config.address, SSCRT_ADDRESS, pendingKey.current)])
          }}
        >
          Set a viewing key
        </Button>
      </div>

      <section className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-label text-text-muted">What this is</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Pay the auditor"
            className="rounded-control border border-border bg-surface px-3 py-2 text-base outline-none focus:border-accent"
          />
          <span className="text-label text-text-faint">
            For the other members. It travels with the proposal and is not part of the transaction.
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
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-title">Messages</h2>

        {rows.map((row, index) => (
          <MessageRow
            key={row.id}
            row={row}
            index={index}
            removable={rows.length > 1}
            onChange={(patch) =>
              setRows((current) =>
                current.map((entry) => (entry.id === row.id ? { ...entry, ...patch } : entry))
              )
            }
            onRemove={() => setRows((current) => current.filter((entry) => entry.id !== row.id))}
            sender={config.address}
          />
        ))}

        <Button
          variant="text"
          size="sm"
          icon={<Plus size={15} />}
          onClick={() => setRows((current) => [...current, { id: nextId.current++, content: '' }])}
        >
          Add a message
        </Button>

        {foreign.length > 0 ? (
          <p className="text-base text-negative">
            Message {foreign[0].index + 1} acts for {foreign[0].signer}, not for this account. The chain would
            refuse it however many members signed.
          </p>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-title">Transaction</h2>

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
            Fee {formatAmount(estimateFee(gasLimit, GAS_PRICE_USCRT), { reveal: true })} {DISPLAY_DENOM}. A
            contract call cannot be simulated on Secret, so this is an estimate. A transaction that runs out
            of gas costs the fee and the whole round of signatures with it, because the sequence is spent
            either way — so err upwards.
          </span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-label text-text-muted">Paid by (optional)</span>
          <input
            value={granter}
            onChange={(event) => setGranter(event.target.value)}
            placeholder={`${DENOM === 'uscrt' ? 'secret1…' : ''} an account that granted this one a fee allowance`}
            spellCheck={false}
            className="rounded-control border border-border bg-surface px-3 py-2 font-mono text-sm outline-none focus:border-accent"
          />
          <span className="text-label text-text-faint">
            The granter is part of what everyone signs, so it cannot be added or changed afterwards.
          </span>
        </label>
      </section>

      {error ? <p className="text-base text-negative">{error}</p> : null}

      <div className="flex justify-end">
        <Button onClick={propose} disabled={!ready} loading={busy}>
          Create the proposal
        </Button>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Rows                                                                        */
/* -------------------------------------------------------------------------- */

interface Row {
  id: number
  type?: string
  content: string
  error?: string
}

function initialRows(
  handed: { preset?: string; proposalId?: string; option?: string } | null,
  address: string | undefined
): Row[] {
  if (!address) return [{ id: 0, content: '' }]
  if (handed?.preset === 'viewing-key') {
    return [viewingKeyRow(0, address, SSCRT_ADDRESS, generateViewingKey())]
  }
  if (handed?.preset === 'vote' && handed.proposalId) {
    return [voteRow(0, address, handed.proposalId, handed.option ?? 'YES')]
  }
  return [{ id: 0, content: '' }]
}

/**
 * A vote, handed over from the governance screen.
 *
 * The voter is the multisig rather than whoever pressed the button there, and
 * that is the whole reason this detour exists: a group's vote carries the
 * group's stake, and the wallet's own vote carries the wallet's.
 */
function voteRow(id: number, voter: string, proposalId: string, option: string): Row {
  return {
    id,
    type: 'MsgVote',
    content: JSON.stringify({ voter, proposal_id: proposalId, option, metadata: '' }, null, 2)
  }
}

function sendRow(id: number, sender: string): Row {
  return {
    id,
    type: 'MsgSend',
    content: JSON.stringify(
      { from_address: sender, to_address: 'secret1…', amount: `1000000${DENOM}` },
      null,
      2
    )
  }
}

function viewingKeyRow(id: number, sender: string, contract: string, key: string): Row {
  return {
    id,
    type: 'MsgExecuteContract',
    content: JSON.stringify(
      {
        sender,
        contract_address: contract,
        code_hash: '',
        msg: { set_viewing_key: { key } },
        sent_funds: ''
      },
      null,
      2
    )
  }
}

function toDeclared(rows: Row[]): DeclaredMsg[] {
  const declared: DeclaredMsg[] = []
  for (const row of rows) {
    if (!row.type || !row.content.trim()) continue
    try {
      declared.push({ template: row.type, content: JSON.parse(row.content) as Record<string, unknown> })
    } catch {
      // A half-typed message is not a proposal yet; the row shows its own error.
    }
  }
  return declared
}

function isViewingKeyMessage(message: DeclaredMsg): boolean {
  if (message.template !== 'MsgExecuteContract') return false
  const inner = message.content.msg as Record<string, unknown> | undefined
  return Boolean(inner && 'set_viewing_key' in inner)
}

const TYPE_OPTIONS = Object.entries(MESSAGE_TEMPLATES)
  .sort(([, a], [, b]) => a.module.localeCompare(b.module))
  .map(([key, definition]) => ({ id: key, label: key, detail: definition.module }))

function MessageRow({
  row,
  index,
  removable,
  sender,
  onChange,
  onRemove
}: {
  row: Row
  index: number
  removable: boolean
  sender: string
  onChange: (patch: Partial<Row>) => void
  onRemove: () => void
}) {
  const pick = async (type: string) => {
    const secretjs = await import('secretjs')
    const example = MESSAGE_TEMPLATES[type]!.example(secretjs, sender)
    onChange({ type, content: JSON.stringify(example, null, 2), error: undefined })
  }

  const validate = (content: string) => {
    try {
      JSON.parse(content)
      onChange({ content, error: undefined })
    } catch (caught) {
      onChange({ content, error: errorMessage(caught) })
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-card border border-border p-3">
      <div className="flex items-center gap-2">
        <span className="text-label text-text-faint">{index + 1}</span>
        <div className="min-w-0 flex-1">
          <Picker
            label="Message type"
            options={TYPE_OPTIONS}
            value={row.type}
            onChange={(id) => void pick(id)}
            placeholder="Choose a message"
          />
        </div>
        {removable ? (
          <button
            type="button"
            aria-label={`Remove message ${index + 1}`}
            onClick={onRemove}
            className="state-layer rounded-control p-2 text-text-muted"
          >
            <Trash2 size={15} />
          </button>
        ) : null}
      </div>

      <textarea
        value={row.content}
        onChange={(event) => validate(event.target.value)}
        rows={8}
        spellCheck={false}
        placeholder="{}"
        className="rounded-control border border-border bg-surface px-3 py-2 font-mono text-sm outline-none focus:border-accent"
      />

      {row.error ? <p className="text-label text-negative">{row.error}</p> : null}

      {allTokens().some((token) => token.address === (safeParse(row.content)?.contract_address ?? '')) ? (
        <p className="text-label text-text-faint">
          {tokenNameFor(String(safeParse(row.content)?.contract_address ?? ''))}
        </p>
      ) : null}
    </div>
  )
}

function safeParse(content: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(content) as Record<string, unknown>
  } catch {
    return undefined
  }
}

function tokenNameFor(address: string): string {
  const token = allTokens().find((entry) => entry.address === address)
  return token ? `This contract is ${token.symbol}.` : ''
}

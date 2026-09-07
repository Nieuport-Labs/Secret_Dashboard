import { Check, Copy, ExternalLink, Eye, Plus, Send, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import type { Msg, SecretNetworkClient } from 'secretjs'

import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import Picker from '@/components/ui/Picker'
import { DENOM, explorerTxUrl, GAS_PRICE_USCRT } from '@/chains/secret4'
import { MESSAGE_TEMPLATES } from '@/lib/messageTemplates'
import { useFeePayer } from '@/store/feePayer'
import { useWallet } from '@/store/wallet'

/** Fallback when the chain cannot simulate a message to size it — secretjs
 *  refuses to simulate `MsgExecuteContract` and `MsgInstantiateContract` at
 *  all ("for security reasons"), and a simulation can fail outright for other
 *  reasons too. Generous enough for a bank send or a staking message; a
 *  contract call that needs more than this will have to be sent knowing that. */
const GAS_FALLBACK_PER_MESSAGE = 150_000
/** Simulated gas is usually a slight underestimate of what execution takes;
 *  this margin is the same kind of cushion `GAS_PRICE_USCRT` already is. */
const GAS_SIMULATION_MARGIN = 1.3

interface Row {
  id: number
  type?: string
  content: string
  error?: string
}

type SendState = { kind: 'idle' } | { kind: 'sending' } | { kind: 'done'; hash: string } | { kind: 'failed'; message: string }

const TYPE_OPTIONS = Object.entries(MESSAGE_TEMPLATES)
  .sort(([, a], [, b]) => a.module.localeCompare(b.module))
  .map(([key, def]) => ({ id: key, label: key, detail: def.module }))

/** Asks the chain what this exact transaction would cost rather than
 *  guessing, the same way every other screen in this app sizes its own gas.
 *  Falls back to a flat estimate when the chain cannot simulate it —
 *  `MsgExecuteContract` and `MsgInstantiateContract` never can. */
async function estimateGas(client: SecretNetworkClient, messages: Msg[]): Promise<number> {
  try {
    const sim = await client.tx.simulate(messages)
    const used = Number(sim.gas_info?.gas_used ?? 0)
    if (used > 0) return Math.ceil(used * GAS_SIMULATION_MARGIN)
  } catch {
    // Unsupported message type, or the node refused the simulation outright.
  }
  return messages.length * GAS_FALLBACK_PER_MESSAGE
}

/**
 * Compose and send raw chain messages.
 *
 * Every other screen in this app builds its own messages from a form so a
 * typo cannot reach the chain. This is the exception on purpose: a power tool
 * has to be able to send whatever the SDK can sign, not only the cases the
 * app anticipated. Keplr's own confirmation screen — showing the exact
 * message about to be signed — is still there as the last check before
 * anything leaves.
 */
export default function MessageComposer() {
  const client = useWallet((state) => state.client)
  const address = useWallet((state) => state.address)
  const granterFor = useFeePayer((state) => state.granterFor)

  const nextId = useRef(1)
  const [rows, setRows] = useState<Row[]>([{ id: 0, content: '' }])
  const [viewingJson, setViewingJson] = useState<string | undefined>()
  const [copied, setCopied] = useState(false)
  const [state, setState] = useState<SendState>({ kind: 'idle' })

  const addRow = () => {
    setRows((current) => [...current, { id: nextId.current++, content: '' }])
  }

  const removeRow = (id: number) => {
    setRows((current) => (current.length > 1 ? current.filter((row) => row.id !== id) : current))
  }

  const updateRow = (id: number, patch: Partial<Row>) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  }

  const pickType = async (id: number, type: string) => {
    if (!address) return
    const secretjs = await import('secretjs')
    const example = MESSAGE_TEMPLATES[type]!.example(secretjs, address)
    updateRow(id, { type, content: JSON.stringify(example, null, 2), error: undefined })
  }

  /** Parses every row's JSON without building messages yet — used for both
   *  the "view full message" preview and as the first half of sending, so
   *  the two never disagree about what a row currently holds. Pure — it only
   *  reads `rows`, so it is safe to call while rendering as well as from an
   *  event handler; only `validate` below writes the per-row errors back. */
  const parseRow = (row: Row): { content: Record<string, unknown> } | { error: string } => {
    if (!row.type) return { error: 'Choose a message type.' }
    try {
      return { content: JSON.parse(row.content) as Record<string, unknown> }
    } catch (caught) {
      return { error: caught instanceof Error ? caught.message : 'Invalid JSON.' }
    }
  }

  /** Parses every row, writing any errors back so they show under the
   *  message they belong to, and returns the parsed messages only when every
   *  row is clean. Called from an event handler, never during render. */
  const validate = (): Array<{ type: string; content: Record<string, unknown> }> | undefined => {
    const results = rows.map((row) => ({ row, result: parseRow(row) }))
    setRows(results.map(({ row, result }) => ({ ...row, error: 'error' in result ? result.error : undefined })))
    if (results.some(({ result }) => 'error' in result)) return undefined
    return results.map(({ row, result }) => ({
      type: row.type!,
      content: (result as { content: Record<string, unknown> }).content
    }))
  }

  const send = async () => {
    if (!client || !address) return
    const parsed = validate()
    if (!parsed) return

    setState({ kind: 'sending' })
    try {
      const secretjs = await import('secretjs')
      const messages: Msg[] = []
      const typeUrls: string[] = []
      for (const { type, content } of parsed) {
        const template = MESSAGE_TEMPLATES[type]!
        messages.push(template.build(secretjs, content))
        typeUrls.push(template.typeUrl)
      }

      const limit = await estimateGas(client, messages)
      const tx = await client.tx.broadcast(messages, {
        gasLimit: limit,
        gasPriceInFeeDenom: GAS_PRICE_USCRT,
        feeDenom: DENOM,
        feeGranter: granterFor(limit, typeUrls)
      })

      if (tx.code !== 0) {
        setState({ kind: 'failed', message: tx.rawLog || `The chain rejected it (code ${tx.code}).` })
        return
      }
      setState({ kind: 'done', hash: tx.transactionHash })
    } catch (caught) {
      setState({ kind: 'failed', message: caught instanceof Error ? caught.message : String(caught) })
    }
  }

  const viewFull = () => {
    const parsed = validate()
    if (parsed) setViewingJson(JSON.stringify(parsed, null, 2))
  }

  return (
    <section className="flex flex-col gap-5">
      <div>
        <h2 className="text-title">Compose messages</h2>
        <p className="mt-1 max-w-[62ch] text-base text-text-muted">
          Build a transaction from one or more raw chain messages. Picking a type fills in a template — the
          placeholder values are not real addresses, so review every field before sending.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {rows.map((row, index) => (
          <div key={row.id} className="card flex flex-col gap-3 p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-text-muted">Message #{index + 1}</span>
              <button
                type="button"
                onClick={() => removeRow(row.id)}
                disabled={rows.length === 1}
                aria-label="Remove message"
                className="state-layer rounded-control p-1.5 text-text-faint disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Trash2 size={14} aria-hidden />
              </button>
            </div>

            <Picker
              label="Message type"
              placeholder="Select type"
              options={TYPE_OPTIONS}
              value={row.type}
              onChange={(type) => void pickType(row.id, type)}
              disabled={!address}
            />

            <textarea
              value={row.content}
              onChange={(event) => updateRow(row.id, { content: event.target.value, error: undefined })}
              rows={Math.max(6, row.content.split('\n').length)}
              placeholder="Content"
              spellCheck={false}
              className="resize-y rounded-control border border-border bg-surface px-3 py-2.5 font-mono text-sm outline-none placeholder:text-text-faint"
            />

            {row.error ? <p className="text-sm text-negative">{row.error}</p> : null}
          </div>
        ))}
      </div>

      <Button variant="soft" shape="control" className="self-center" icon={<Plus size={14} aria-hidden />} onClick={addRow}>
        Add message
      </Button>

      <div className="flex gap-2">
        <Button
          variant="soft"
          shape="control"
          className="flex-1"
          icon={<Eye size={14} aria-hidden />}
          onClick={viewFull}
        >
          View full message
        </Button>
        <Button
          variant="primary"
          className="flex-1"
          icon={<Send size={14} aria-hidden />}
          loading={state.kind === 'sending'}
          disabled={!client || !address}
          onClick={() => void send()}
        >
          Send Tx
        </Button>
      </div>

      {state.kind === 'done' ? (
        <p className="flex items-center gap-1.5 text-base text-positive">
          Sent.
          <a
            className="inline-flex items-center gap-1 underline underline-offset-4"
            href={explorerTxUrl(state.hash)}
            target="_blank"
            rel="noreferrer noopener"
          >
            View transaction
            <ExternalLink size={13} aria-hidden />
          </a>
        </p>
      ) : null}

      {state.kind === 'failed' ? (
        <pre className="whitespace-pre-wrap break-words card p-4 font-mono text-sm text-negative">
          {state.message}
        </pre>
      ) : null}

      <Modal open={viewingJson !== undefined} onClose={() => setViewingJson(undefined)} title="Full message">
        {viewingJson ? (
          <>
            <pre className="max-h-[50dvh] overflow-auto whitespace-pre-wrap break-words rounded-control bg-surface p-3 font-mono text-sm">
              {viewingJson}
            </pre>
            <Button
              variant="soft"
              shape="control"
              icon={copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
              onClick={() => {
                void navigator.clipboard.writeText(viewingJson)
                setCopied(true)
                setTimeout(() => setCopied(false), 1600)
              }}
            >
              {copied ? 'Copied' : 'Copy to clipboard'}
            </Button>
          </>
        ) : null}
      </Modal>
    </section>
  )
}

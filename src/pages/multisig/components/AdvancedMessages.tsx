import { Plus, Trash2 } from 'lucide-react'
import { useRef } from 'react'

import Button from '@/components/ui/Button'
import Picker from '@/components/ui/Picker'
import { errorMessage } from '@/lib/errors'
import { MESSAGE_TEMPLATES } from '@/lib/messageTemplates'
import { allTokens } from '@/tokens/registry'
import type { Row } from './advancedRows'

/**
 * Writing the messages by hand.
 *
 * The escape hatch, and the reason the forms beside it can be opinionated:
 * whatever the chain can be asked to do, a group can propose here, including
 * calls to contracts this app has never heard of. That is worth keeping even
 * though almost nobody should need it — the alternative is a dashboard whose
 * answer to an unanticipated case is "you cannot".
 *
 * It is the same editor Powertools uses, with the same template list, so the
 * one person in a group who does reach for it is somewhere familiar.
 */

const TYPE_OPTIONS = Object.entries(MESSAGE_TEMPLATES)
  .sort(([, a], [, b]) => a.module.localeCompare(b.module))
  .map(([key, definition]) => ({ id: key, label: key, detail: definition.module }))

export default function AdvancedMessages({
  rows,
  onRows,
  sender
}: {
  rows: Row[]
  onRows: (rows: Row[]) => void
  sender: string
}) {
  const nextId = useRef(rows.length)

  const update = (id: number, patch: Partial<Row>) =>
    onRows(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)))

  return (
    <div className="flex flex-col gap-3">
      {rows.map((row, index) => (
        <MessageRow
          key={row.id}
          row={row}
          index={index}
          removable={rows.length > 1}
          sender={sender}
          onChange={(patch) => update(row.id, patch)}
          onRemove={() => onRows(rows.filter((entry) => entry.id !== row.id))}
        />
      ))}

      <Button
        variant="text"
        size="sm"
        icon={<Plus size={15} />}
        onClick={() => onRows([...rows, { id: nextId.current++, content: '' }])}
      >
        Add a message
      </Button>
    </div>
  )
}

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
    // Prefilled with the multisig as the acting account, since a message that
    // acts for anybody else is refused before it can be proposed.
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

  const parsed = safeParse(row.content)
  const contract = String(parsed?.contract_address ?? '')
  const token = contract ? allTokens().find((entry) => entry.address === contract) : undefined

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
      {token ? <p className="text-label text-text-faint">This contract is {token.symbol}.</p> : null}
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

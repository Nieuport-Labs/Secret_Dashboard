import { Check, ChevronDown, Search } from 'lucide-react'
import { useMemo, useState } from 'react'

import Modal from '@/components/ui/Modal'
import { cn } from '@/lib/cn'

export interface PickerOption {
  id: string
  label: string
  /** Second line: what this is, when the label alone is a ticker or a codename. */
  detail?: string
  image?: string
  /** Trailing, right-aligned — the balance behind this choice, when there is one. */
  meta?: string
}

interface DialogProps {
  open: boolean
  onClose: () => void
  label: string
  options: PickerOption[]
  value?: string
  onChange: (id: string) => void
}

/**
 * The searchable list, without a trigger of its own.
 *
 * Split out because not every chooser wants the same button in front of it:
 * the token is picked by clicking the token itself, inside the amount row,
 * where a second full-width field would only repeat what the amount already
 * shows.
 */
export function PickerDialog({ open, onClose, label, options, value, onChange }: DialogProps) {
  const [query, setQuery] = useState('')

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return options
    return options.filter(
      (option) => option.label.toLowerCase().includes(needle) || option.detail?.toLowerCase().includes(needle)
    )
  }, [options, query])

  return (
    <Modal
      open={open}
      onClose={() => {
        setQuery('')
        onClose()
      }}
      title={label}
    >
      <div className="flex items-center gap-2.5 rounded-control border border-border bg-surface px-3 py-2">
        <Search size={16} aria-hidden className="shrink-0 text-text-muted" />
        <input
          data-autofocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Search ${label.toLowerCase()}`}
          className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-text-faint"
        />
      </div>

      {/* Capped rather than allowed to grow: the dialog has to stay a dialog,
          and a list this long is scrolled, not read. */}
      <ul className="-mx-1 max-h-[min(420px,50dvh)] overflow-y-auto px-1">
        {visible.map((option) => (
          <li key={option.id}>
            <button
              type="button"
              onClick={() => {
                onChange(option.id)
                setQuery('')
                onClose()
              }}
              className="state-layer flex w-full items-center gap-2.5 rounded-control px-2 py-2 text-left"
            >
              {option.image ? (
                <img src={option.image} alt="" className="size-7 shrink-0 rounded-pill" />
              ) : null}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-base font-medium">{option.label}</span>
                {option.detail ? (
                  <span className="block truncate text-label text-text-faint">{option.detail}</span>
                ) : null}
              </span>
              {option.meta ? (
                <span className="shrink-0 text-label tabular-nums text-text-faint">{option.meta}</span>
              ) : null}
              {option.id === value ? <Check size={16} aria-hidden className="shrink-0 text-accent" /> : null}
            </button>
          </li>
        ))}
        {visible.length === 0 ? (
          <li className="px-2 py-6 text-center text-base text-text-muted">Nothing matches.</li>
        ) : null}
      </ul>
    </Modal>
  )
}

interface Props extends Omit<DialogProps, 'open' | 'onClose'> {
  /** Shown on the trigger when nothing is selected yet. */
  placeholder?: string
  disabled?: boolean
}

/**
 * A chooser with the standard full-width field in front of it.
 *
 * A `<select>` cannot show a logo, and thirty-seven chains in an unsearchable
 * native dropdown is a scroll, not a choice. This is the field plus the
 * searchable list — which also means the logo is present at the moment of
 * choosing.
 */
export default function Picker({ label, options, value, onChange, placeholder, disabled }: Props) {
  const [open, setOpen] = useState(false)
  const selected = options.find((option) => option.id === value)

  return (
    <>
      <button
        type="button"
        disabled={disabled || options.length === 0}
        onClick={() => setOpen(true)}
        className={cn(
          'state-layer flex w-full items-center gap-2.5 rounded-control border border-border bg-surface px-3 py-2.5 text-left',
          'disabled:cursor-not-allowed disabled:opacity-50'
        )}
      >
        {selected?.image ? (
          <img src={selected.image} alt="" className="size-6 shrink-0 rounded-pill" />
        ) : null}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-medium">
            {selected?.label ?? placeholder ?? `Choose ${label.toLowerCase()}`}
          </span>
          {selected?.detail ? (
            <span className="block truncate text-label text-text-faint">{selected.detail}</span>
          ) : null}
        </span>
        <ChevronDown size={16} aria-hidden className="shrink-0 text-text-muted" />
      </button>

      <PickerDialog
        open={open}
        onClose={() => setOpen(false)}
        label={label}
        options={options}
        value={value}
        onChange={onChange}
      />
    </>
  )
}

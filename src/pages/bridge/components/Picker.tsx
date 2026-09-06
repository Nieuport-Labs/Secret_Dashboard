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
}

interface Props {
  label: string
  options: PickerOption[]
  value?: string
  onChange: (id: string) => void
  /** Shown on the trigger when nothing is selected yet. */
  placeholder?: string
  disabled?: boolean
}

/**
 * A chain or token chooser.
 *
 * A `<select>` cannot show a logo, and thirty-seven chains or ninety-six tokens
 * in an unsearchable native dropdown is a scroll, not a choice. This is the
 * trigger plus a searchable list — which also means the logo is present at the
 * moment of choosing, and a ticker never has to stand alone.
 */
export default function Picker({ label, options, value, onChange, placeholder, disabled }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const selected = options.find((option) => option.id === value)

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return options
    return options.filter(
      (option) => option.label.toLowerCase().includes(needle) || option.detail?.toLowerCase().includes(needle)
    )
  }, [options, query])

  return (
    <>
      <button
        type="button"
        disabled={disabled || options.length === 0}
        onClick={() => {
          setQuery('')
          setOpen(true)
        }}
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

      <Modal open={open} onClose={() => setOpen(false)} title={label}>
        <div className="flex items-center gap-2.5 rounded-control border border-border bg-surface px-3 py-2">
          <Search size={16} aria-hidden className="shrink-0 text-text-muted" />
          <input
            autoFocus
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
                  setOpen(false)
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
                {option.id === value ? (
                  <Check size={16} aria-hidden className="shrink-0 text-accent" />
                ) : null}
              </button>
            </li>
          ))}
          {visible.length === 0 ? (
            <li className="px-2 py-6 text-center text-base text-text-muted">Nothing matches.</li>
          ) : null}
        </ul>
      </Modal>
    </>
  )
}

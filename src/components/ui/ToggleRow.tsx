import { cn } from '@/lib/cn'

interface Props {
  label: string
  description?: string
  checked: boolean
  onChange: (checked: boolean) => void
  /** Shown beside the label, e.g. "Recommended". */
  tag?: string
}

/**
 * A setting that is on or off: the label and what it means on the left, a
 * switch on the right. The whole row is the control.
 */
export default function ToggleRow({ label, description, checked, onChange, tag }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="state-layer flex w-full items-start gap-3 rounded-control bg-surface p-3 text-left"
    >
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-base font-medium">{label}</span>
          {tag ? (
            <span className="rounded-pill bg-accent-container px-2 py-0.5 text-label text-accent">{tag}</span>
          ) : null}
        </span>
        {description ? <span className="mt-0.5 block text-sm text-text-muted">{description}</span> : null}
      </span>
      <span
        aria-hidden
        className={cn(
          'relative mt-0.5 inline-flex h-6 w-10 shrink-0 items-center rounded-pill transition-colors duration-[var(--duration-short)] ease-[var(--ease-standard)]',
          checked ? 'bg-accent-strong' : 'border border-border bg-surface'
        )}
      >
        <span
          className={cn(
            'absolute size-4 rounded-pill transition-transform duration-[var(--duration-short)] ease-[var(--ease-standard)]',
            checked ? 'translate-x-5 bg-[var(--color-accent-text)]' : 'translate-x-1 bg-text-muted'
          )}
        />
      </span>
    </button>
  )
}

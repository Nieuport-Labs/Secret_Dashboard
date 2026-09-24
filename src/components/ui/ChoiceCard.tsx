import type { LucideIcon } from 'lucide-react'

import { cn } from '@/lib/cn'

interface Props {
  icon: LucideIcon
  title: string
  description: string
  onClick?: () => void
  /** A quiet tag beside the title — "Soon", say. */
  badge?: string
  /**
   * The option most people should pick. Outlined and tagged in the accent, so
   * it is findable at a glance without the other one looking disabled.
   */
  recommended?: boolean
}

/**
 * One of a short column of options in a dialog: an icon, a title and a line
 * saying what picking it means. The whole card is the button.
 */
export default function ChoiceCard({ icon: Icon, title, description, onClick, badge, recommended }: Props) {
  const disabled = !onClick

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex items-start gap-3.5 rounded-card border p-4 text-left',
        recommended ? 'border-accent' : 'border-border',
        disabled ? 'cursor-not-allowed opacity-60' : 'state-layer'
      )}
    >
      <span
        aria-hidden
        className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-pill bg-accent-container text-accent"
      >
        <Icon size={18} strokeWidth={1.75} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-title">{title}</span>
          {recommended ? (
            <span className="rounded-pill bg-accent-container px-2 py-0.5 text-label text-accent">
              Recommended
            </span>
          ) : null}
          {badge ? (
            <span className="rounded-pill border border-border px-2 py-0.5 text-label text-text-muted">
              {badge}
            </span>
          ) : null}
        </span>
        <span className="mt-1 block text-base text-text-muted">{description}</span>
      </span>
    </button>
  )
}

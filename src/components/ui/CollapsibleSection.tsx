import { ChevronDown } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { cn } from '@/lib/cn'

interface Props {
  title: string
  /** Shown under the heading while open — a proposal's own caveat text, say. */
  description?: ReactNode
  defaultOpen?: boolean
  children: ReactNode
}

/**
 * A section that can be folded shut behind its own heading.
 *
 * Starts open: collapsing is an escape hatch for content that turns out to be
 * more than someone wants on screen — a long JSON message payload, a wall of
 * validators — not the first impression of a proposal.
 */
export default function CollapsibleSection({ title, description, defaultOpen = true, children }: Props) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <section className="flex flex-col gap-2.5">
      <button
        type="button"
        onClick={() => setOpen((shown) => !shown)}
        aria-expanded={open}
        className="state-layer -mx-1.5 flex w-fit items-center gap-1.5 rounded-control px-1.5 py-0.5"
      >
        <h2 className="text-title">{title}</h2>
        <ChevronDown
          size={16}
          aria-hidden
          className={cn(
            'text-text-faint transition-transform duration-[var(--duration-short)] ease-[var(--ease-standard)]',
            open && 'rotate-180'
          )}
        />
      </button>
      {open ? (
        <>
          {description ? <p className="text-label text-text-faint">{description}</p> : null}
          {children}
        </>
      ) : null}
    </section>
  )
}

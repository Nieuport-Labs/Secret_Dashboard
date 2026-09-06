import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { useFocusTrap } from '@/hooks/useFocusTrap'
import { cn } from '@/lib/cn'

interface Props {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}

/**
 * The right-hand panel the design uses for Receive (Figma 31:531).
 *
 * A drawer that traps nothing and cannot be dismissed with a key is a trap for
 * anyone not using a mouse, so Escape closes it, focus moves inside on open and
 * returns to where it came from on close, and Tab cycles within.
 *
 * Rendered into <body> rather than where it is written. `position: fixed` is
 * fixed to the viewport only until an ancestor has a transform, a filter or a
 * backdrop-filter — any of those makes that ancestor the containing block
 * instead. The header is frosted glass, so a drawer written inside it was laid
 * out inside the header: the full height of a 45px strip, which is why it
 * looked like it opened into the top bar. The portal also settles z-index for
 * good, since the panel no longer has to out-stack anything to be seen.
 */
export default function Drawer({ open, onClose, title, children }: Props) {
  const panel = useFocusTrap(open, onClose)

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-40">
      {/* Dimming and blurring the page is what makes the panel read as a layer
          above it rather than a second page. */}
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-scrim backdrop-blur-sm"
      />

      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          /*
           * Inset from every edge rather than welded to the right one, so it
           * reads as a sheet resting on the page instead of a second column
           * grafted onto it — which is also what lets it be rounded on all four
           * corners and carry its edge the whole way round.
           *
           * `inset-5` sets all four offsets and `left-auto` releases the left,
           * so the width is the panel's own: the viewport less both insets, up
           * to 380px.
           */
          'absolute inset-5 left-auto flex w-[calc(100%-2.5rem)] max-w-[380px] flex-col',
          // Frosted rather than a solid slab: the page stays faintly readable
          // through it, so the panel reads as covering the page rather than
          // replacing it.
          'glass overflow-hidden rounded-card border border-glass-edge shadow-panel outline-none',
          'motion-safe:animate-[drawer-in_var(--duration-medium)_var(--ease-emphasised)]'
        )}
      >
        {/*
          The title stays; only the body scrolls. The panel used to scroll as a
          whole, which sent the heading and the close button off the top on a
          long panel and ran the scrollbar straight through the rounded corners.
        */}
        <div className="flex shrink-0 items-start justify-between gap-4 px-6 pb-4 pt-6">
          <h2 className="text-headline">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="state-layer -m-1.5 rounded-pill p-1.5 text-text-muted"
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 pb-6">{children}</div>
      </div>
    </div>,
    document.body
  )
}

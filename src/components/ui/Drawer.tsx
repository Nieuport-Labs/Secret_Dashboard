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
          'absolute inset-y-0 right-0 flex w-full max-w-[380px] flex-col gap-5 overflow-y-auto',
          // Frosted rather than a solid slab: the page stays faintly readable
          // through it, so the panel reads as covering the page rather than
          // replacing it.
          'glass border-l border-glass-edge shadow-panel p-6 outline-none',
          'motion-safe:animate-[drawer-in_var(--duration-medium)_var(--ease-emphasised)]'
        )}
      >
        <div className="flex items-start justify-between gap-4">
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
        {children}
      </div>
    </div>,
    document.body
  )
}

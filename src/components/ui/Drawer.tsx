import { X } from 'lucide-react'
import type { ReactNode } from 'react'

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
 */
export default function Drawer({ open, onClose, title, children }: Props) {
  const panel = useFocusTrap(open, onClose)

  if (!open) return null

  return (
    <div className="fixed inset-0 z-40">
      {/* Dimming the page is what makes the panel read as a layer above it. */}
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
      />

      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          'absolute inset-y-0 right-0 flex w-full max-w-[380px] flex-col gap-6 overflow-y-auto',
          'bg-surface-2 p-[30px] outline-none',
          'motion-safe:animate-[drawer-in_var(--duration-medium)_var(--ease-emphasised)]'
        )}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-headline">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="state-layer -m-1 rounded-control p-1 text-text-muted"
          >
            <X size={20} aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

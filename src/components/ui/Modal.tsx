import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { useFocusTrap } from '@/hooks/useFocusTrap'

interface Props {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
}

/**
 * Centred dialog, for a decision the user has to finish before moving on.
 *
 * Portalled into <body> for the same reason the drawer is: a frosted ancestor
 * becomes the containing block for `position: fixed`, and a dialog opened from
 * the header would otherwise be laid out inside the header.
 */
export default function Modal({ open, onClose, title, description, children }: Props) {
  const panel = useFocusTrap(open, onClose)

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
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
        className="glass-panel relative flex w-full max-w-[420px] flex-col gap-5 rounded-card p-5 outline-none motion-safe:animate-[modal-in_var(--duration-medium)_var(--ease-emphasised)]"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-headline">{title}</h2>
            {description ? <p className="mt-1 text-base text-text-muted">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="state-layer -m-1.5 shrink-0 rounded-pill p-1.5 text-text-muted"
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

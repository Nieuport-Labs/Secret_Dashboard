import { X } from 'lucide-react'
import type { ReactNode } from 'react'

import { useFocusTrap } from '@/hooks/useFocusTrap'

interface Props {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
}

/** Centred dialog, for a decision the user has to finish before moving on. */
export default function Modal({ open, onClose, title, description, children }: Props) {
  const panel = useFocusTrap(open, onClose)

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
      />

      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="relative flex w-full max-w-[440px] flex-col gap-5 rounded-card bg-surface-2 p-6 outline-none motion-safe:animate-[modal-in_var(--duration-medium)_var(--ease-emphasised)]"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">{title}</h2>
            {description ? <p className="mt-1 text-base text-text-muted">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="state-layer -m-1 shrink-0 rounded-control p-1 text-text-muted"
          >
            <X size={20} aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

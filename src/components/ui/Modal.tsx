import { ChevronLeft, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { useFocusTrap } from '@/hooks/useFocusTrap'

interface Props {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  /** Rendered beside the heading — a validator's avatar, say. Decorative: the
   *  accessible name still comes from `title` alone. */
  icon?: ReactNode
  /**
   * Returns to the step this one was opened from. Given only by a dialog that
   * is genuinely one of several in sequence — closing such a step and closing
   * the whole flow are different intentions, and one button cannot mean both.
   */
  onBack?: () => void
  children: ReactNode
}

/**
 * Centred dialog, for a decision the user has to finish before moving on.
 *
 * Portalled into <body> for the same reason the drawer is: a frosted ancestor
 * becomes the containing block for `position: fixed`, and a dialog opened from
 * the header would otherwise be laid out inside the header.
 */
export default function Modal({ open, onClose, title, description, icon, onBack, children }: Props) {
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
        /*
          Never taller than the screen it is on. Without the cap a dialog with
          a lot in it grows past the viewport and loses its heading off the top
          and its primary button off the bottom — the two parts it cannot
          afford to lose. `dvh` rather than `vh` so a mobile browser's
          retracting toolbar does not cut it off anyway, and the 2rem is the
          padding on the wrapper this sits in.

          `overflow-y-auto` is the fallback for a dialog whose content does not
          manage its own scrolling; one that does (a `min-h-0 flex-1` child)
          keeps this outer box from ever needing to scroll.
        */
        className="glass-panel relative flex max-h-[calc(100dvh-2rem)] w-full max-w-[420px] flex-col gap-5 overflow-y-auto rounded-card p-5 outline-none motion-safe:animate-[modal-in_var(--duration-medium)_var(--ease-emphasised)]"
      >
        {/* Never squeezed by a tall body — the heading is the dialog's label. */}
        <div className="flex shrink-0 items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            {onBack ? (
              <button
                type="button"
                onClick={onBack}
                aria-label="Back"
                className="state-layer -m-1.5 shrink-0 rounded-pill p-1.5 text-text-muted"
              >
                <ChevronLeft size={18} aria-hidden />
              </button>
            ) : null}
            {icon}
            <div className="min-w-0">
              {/*
                Wraps rather than truncates. A dialog's heading is the one piece
                of text on it that has to be read in full — a governance
                proposal's title runs to a sentence, and an ellipsis there hides
                the thing being decided on.
              */}
              <h2 className="text-balance break-words text-headline">{title}</h2>
              {description ? <p className="mt-1 text-base text-text-muted">{description}</p> : null}
            </div>
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

import { useEffect, useRef } from 'react'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Keep focus inside an overlay while it is open, and give it back on close.
 *
 * Without this, a keyboard user tabs straight out of a dialog into the page
 * behind it — which is still rendered, still focusable, and now sitting behind
 * a scrim. Escape closes, because a dialog dismissable only by clicking one
 * specific pixel is a dead end.
 *
 * @returns ref for the element that should contain focus.
 */
export function useFocusTrap(open: boolean, onClose: () => void) {
  const container = useRef<HTMLDivElement>(null)
  const returnFocusTo = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return

    returnFocusTo.current = document.activeElement as HTMLElement | null
    container.current?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (event.key !== 'Tab' || !container.current) return

      const focusable = container.current.querySelectorAll<HTMLElement>(FOCUSABLE)
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    // The page behind must not scroll while an overlay is up.
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      returnFocusTo.current?.focus()
    }
  }, [open, onClose])

  return container
}

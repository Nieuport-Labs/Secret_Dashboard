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
 * The effect depends on `open` and nothing else. It used to depend on `onClose`
 * as well, which is the sort of dependency that looks correct and is a bug: a
 * caller passing an inline arrow hands over a new function on every render, so
 * every keystroke in a dialog tore the trap down and rebuilt it — and tearing
 * it down returns focus to whatever opened the dialog. Typing in a search field
 * inside one meant re-clicking the field after every single letter. The
 * callback lives in a ref instead, so it is always current without being a
 * reason to re-run.
 *
 * @returns ref for the element that should contain focus.
 */
export function useFocusTrap(open: boolean, onClose: () => void) {
  const container = useRef<HTMLDivElement>(null)
  const returnFocusTo = useRef<HTMLElement | null>(null)

  const close = useRef(onClose)
  close.current = onClose

  useEffect(() => {
    if (!open) return

    returnFocusTo.current = document.activeElement as HTMLElement | null

    /*
     * A dialog that opens with a search field should open with the caret in it.
     * `autoFocus` cannot do that here: React applies it while the node attaches,
     * and this effect — which belongs to the parent — runs afterwards and takes
     * the focus back. So the element asks for it explicitly instead.
     */
    const wanted = container.current?.querySelector<HTMLElement>('[data-autofocus]')
    ;(wanted ?? container.current)?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close.current()
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
  }, [open])

  return container
}

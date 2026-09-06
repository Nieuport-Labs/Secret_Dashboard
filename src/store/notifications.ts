import { create } from 'zustand'

/**
 * The toast queue.
 *
 * Four shapes, from the design (Figma 34:688, 36:79, 36:88, 36:3). The last of
 * them is not merely informational: a public token arriving unwrapped is the
 * moment to offer wrapping it, because that is exactly when the user knows what
 * it is and why they have it.
 */

export type ToastKind =
  /** A private token arrived. Nothing to do; it is already shielded. */
  | 'received-private'
  /** A public token arrived. Offers to wrap it. */
  | 'received-public'
  | 'wrapped'
  | 'bridged'
  | 'error'

export interface Toast {
  id: string
  kind: ToastKind
  /** Ticker, e.g. sATOM. */
  symbol?: string
  /** Already formatted for reading. */
  amount?: string
  image?: string
  /** SNIP-20 contract to wrap into, for `received-public`. */
  wrapContract?: string
  message?: string
}

interface NotificationState {
  toasts: Toast[]
  push: (toast: Omit<Toast, 'id'>) => string
  dismiss: (id: string) => void
  clear: () => void
}

/**
 * How long a toast stays. Errors do not expire on their own: a message nobody
 * read is a message nobody can act on, and the wrap offer needs a decision.
 */
const DISMISS_AFTER_MS: Partial<Record<ToastKind, number>> = {
  'received-private': 8000,
  wrapped: 6000,
  bridged: 6000
}

/** Cap the stack, so a burst of arrivals cannot bury the page. */
const MAX_TOASTS = 4

export const useNotifications = create<NotificationState>()((set, get) => ({
  toasts: [],

  push: (toast) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }].slice(-MAX_TOASTS) }))

    const after = DISMISS_AFTER_MS[toast.kind]
    if (after) setTimeout(() => get().dismiss(id), after)

    return id
  },

  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),

  clear: () => set({ toasts: [] })
}))

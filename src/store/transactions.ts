import { create } from 'zustand'

/**
 * Transactions in flight, for the progress cards in the corner.
 *
 * Kept apart from the toast queue on purpose. A toast says something happened;
 * one of these is a thing still happening, and it changes under the user's eyes
 * — from waiting on the wallet, to a block, to the far chain — so it has to be
 * updated in place rather than replaced by a new card at every step.
 */

export type TxStatus =
  | 'running'
  | 'done'
  | 'failed'
  /** Nothing has gone wrong that can be seen, but it has stopped being watched. */
  | 'stalled'

export interface TxLink {
  label: string
  url: string
}

export interface TrackedTx {
  id: string
  /** What is being done, amount included where there is one: "Send 0.5 USDC". */
  label: string
  /** Who or where it goes: "to osmo1…4q8lct". */
  detail?: string
  /** The places it passes through, in order — "Sign", "Secret", "Noble", "Osmosis". */
  steps: string[]
  /** Index of the step under way; `steps.length` once all are behind it. */
  step: number
  status: TxStatus
  /** One line on what is happening now, or what went wrong. */
  text: string
  /** Proof, one per chain it has been seen on. */
  links: TxLink[]
}

interface TransactionState {
  transactions: TrackedTx[]
  start: (tx: Omit<TrackedTx, 'id'>) => string
  update: (id: string, patch: Partial<Omit<TrackedTx, 'id'>>) => void
  addLink: (id: string, link: TxLink) => void
  dismiss: (id: string) => void
}

/**
 * A finished one clears itself; a failure stays until it is read, and so does
 * one still in progress — it is not finished, so neither is the card.
 */
const DONE_DISMISS_MS = 20_000

/** A burst of transactions (a multisig session, say) should not wall off the page. */
const MAX_TRACKED = 4

export const useTransactions = create<TransactionState>()((set, get) => ({
  transactions: [],

  start: (tx) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    set((state) => ({ transactions: [...state.transactions, { ...tx, id }].slice(-MAX_TRACKED) }))
    return id
  },

  update: (id, patch) => {
    set((state) => ({
      transactions: state.transactions.map((tx) => (tx.id === id ? { ...tx, ...patch } : tx))
    }))
    if (patch.status === 'done') setTimeout(() => get().dismiss(id), DONE_DISMISS_MS)
  },

  addLink: (id, link) =>
    set((state) => ({
      transactions: state.transactions.map((tx) =>
        tx.id === id && !tx.links.some((known) => known.url === link.url)
          ? { ...tx, links: [...tx.links, link] }
          : tx
      )
    })),

  dismiss: (id) => set((state) => ({ transactions: state.transactions.filter((tx) => tx.id !== id) }))
}))

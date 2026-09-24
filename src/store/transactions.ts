import { create } from 'zustand'

/**
 * Transactions in flight, for the progress cards in the corner.
 *
 * Kept apart from the toast queue on purpose. A toast says something happened;
 * one of these is a thing still happening, and it changes under the user's eyes
 * — from waiting on the wallet, to waiting on a block, to done — so it has to be
 * updated in place rather than replaced by a new card at every step.
 */

export type TxStage =
  /** The wallet is showing its approval prompt. */
  | 'signing'
  /** Signed and sent; waiting for a block to include it. */
  | 'confirming'
  | 'done'
  | 'failed'

export interface TrackedTx {
  id: string
  /** What is being done, e.g. "Wrap" or "Send to Osmosis". */
  label: string
  stage: TxStage
  hash?: string
  /** Where to look at it, when there is somewhere. */
  url?: string
  /** A line for after it lands — an IBC transfer, say, still has to arrive. */
  note?: string
  /** Why it failed. */
  message?: string
}

interface TransactionState {
  transactions: TrackedTx[]
  start: (label: string) => string
  update: (id: string, patch: Partial<Omit<TrackedTx, 'id'>>) => void
  dismiss: (id: string) => void
}

/**
 * A confirmed one clears itself; a failure stays until it is read. One still in
 * progress never expires — it is not finished, so neither is the card.
 */
const DONE_DISMISS_MS = 10_000

/** A burst of transactions (a multisig session, say) should not wall off the page. */
const MAX_TRACKED = 4

export const useTransactions = create<TransactionState>()((set, get) => ({
  transactions: [],

  start: (label) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    set((state) => ({
      transactions: [...state.transactions, { id, label, stage: 'signing' as const }].slice(-MAX_TRACKED)
    }))
    return id
  },

  update: (id, patch) => {
    set((state) => ({
      transactions: state.transactions.map((tx) => (tx.id === id ? { ...tx, ...patch } : tx))
    }))
    if (patch.stage === 'done') setTimeout(() => get().dismiss(id), DONE_DISMISS_MS)
  },

  dismiss: (id) => set((state) => ({ transactions: state.transactions.filter((tx) => tx.id !== id) }))
}))

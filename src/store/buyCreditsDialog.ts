import { create } from 'zustand'

/**
 * Whether the gas credits dialog is open — its own store for the same reason
 * as the wallet picker's: the header chip draws it, but a notice that credits
 * ran low is the other place that has to be able to open it.
 */
interface BuyCreditsDialogState {
  open: boolean
  show: () => void
  hide: () => void
}

export const useBuyCreditsDialog = create<BuyCreditsDialogState>()((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false })
}))

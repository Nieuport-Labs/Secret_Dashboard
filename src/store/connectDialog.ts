import { create } from 'zustand'

/**
 * Whether the wallet picker is open.
 *
 * Its own store because the thing that opens it is never the thing that draws
 * it: the header asks from the shell, and every screen that needs an account
 * asks from inside its own empty state. Routing to a page that *was* the picker
 * is what this replaces — connecting is a decision, not a destination, and
 * sending someone to the wallet screen to make it left them somewhere they had
 * not asked to go.
 */
interface ConnectDialogState {
  open: boolean
  show: () => void
  hide: () => void
}

export const useConnectDialog = create<ConnectDialogState>()((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false })
}))

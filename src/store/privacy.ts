import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Privacy mode: hide every balance and address on screen.
 *
 * For the moment someone shares their screen, records a walkthrough or takes a
 * screenshot to send to support. This chain's whole point is that those figures
 * are nobody else's business, and a dashboard that makes you crop them out of
 * an image afterwards has rather missed it.
 *
 * It hides, it does not protect: the numbers are still in the page, still in
 * memory, and still one toggle away. It is a curtain, not a lock, and it is
 * deliberately one click to open and close because that is what makes people
 * actually use it.
 *
 * Its own store rather than a settings field so that the masking helpers in
 * `format.ts` can read it without importing anything that imports them back.
 */
interface PrivacyState {
  hidden: boolean
  toggle: () => void
  set: (hidden: boolean) => void
}

export const usePrivacy = create<PrivacyState>()(
  persist(
    (set) => ({
      hidden: false,
      toggle: () => set((state) => ({ hidden: !state.hidden })),
      set: (hidden) => set({ hidden })
    }),
    { name: 'secret-dashboard:privacy' }
  )
)

/**
 * Whether to mask, read outside React.
 *
 * `format.ts` is a module of pure functions called from the middle of a render,
 * not a hook, so this is how it asks. What makes the screen actually change is
 * a subscription at the top of the tree — see `App.tsx`.
 */
export function privacyHidden(): boolean {
  return usePrivacy.getState().hidden
}

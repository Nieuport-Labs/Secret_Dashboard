import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { toOperatorAddress } from '@/lib/validator'
import { useWallet } from '@/store/wallet'

/**
 * Accounts the dashboard can act *as*, beyond the connected wallet.
 *
 * A validator is not a second key — it is the same wallet wearing a different
 * hat, so nothing here holds a signer. What it holds is which hat is on, which
 * is what lets the shell swap its navigation and feel like an account switch
 * rather than a page.
 *
 * Kept apart from `useWallet` on purpose: the wallet store owns a live
 * connection and is rebuilt whenever the extension changes account, while this
 * is a list the user curated and expects to find again after a reload.
 */

export type AccountKind = 'validator' | 'multisig'

export interface LinkedAccount {
  kind: AccountKind
  /** `secretvaloper1…`, and the id everything else keys off. */
  valoper: string
  moniker: string
  /**
   * The `secret1…` account that operates this validator, when the wallet
   * proved it by being that account. Absent for one added by searching, which
   * is a bookmark rather than a login — the difference between the two is
   * exactly what unlocks the operations card.
   */
  operator?: string
}

interface AccountsState {
  accounts: LinkedAccount[]
  /** `undefined` is the ordinary wallet view. */
  activeValoper?: string

  add: (account: LinkedAccount) => void
  remove: (valoper: string) => void
  setActive: (valoper: string) => void
  clearActive: () => void
}

export const useAccounts = create<AccountsState>()(
  persist(
    (set, get) => ({
      accounts: [],

      add: (account) => {
        const rest = get().accounts.filter((a) => a.valoper !== account.valoper)
        // Re-adding after proving operatorship should promote the bookmark, so
        // the new entry replaces the old rather than being refused as a dupe.
        set({ accounts: [...rest, account], activeValoper: account.valoper })
      },

      remove: (valoper) =>
        set((state) => ({
          accounts: state.accounts.filter((a) => a.valoper !== valoper),
          activeValoper: state.activeValoper === valoper ? undefined : state.activeValoper
        })),

      setActive: (valoper) => set({ activeValoper: valoper }),
      clearActive: () => set({ activeValoper: undefined })
    }),
    {
      name: 'secret-dashboard:accounts',
      // The list is the user's; which one was open is this session's.
      partialize: (state) => ({ accounts: state.accounts }),
      merge: (persisted, current) => ({ ...current, ...(persisted as Partial<AccountsState>) })
    }
  )
)

/**
 * Leave validator mode when the wallet behind it changes.
 *
 * Subscribed here rather than called from `useWallet` so the dependency runs
 * one way only. Disconnecting or switching account in the extension means the
 * screen is no longer being driven by whoever proved operatorship, and a shell
 * that kept the validator's navigation would be claiming an authority the new
 * account may not have. The list itself survives — only the open one closes.
 */
useWallet.subscribe((state, previous) => {
  if (state.address !== previous.address) useAccounts.getState().clearActive()
})

export interface ActiveValidator {
  account: LinkedAccount
  /** The wallet on screen is the one that operates it, so it may sign for it. */
  canOperate: boolean
}

/**
 * The validator currently being acted as, if any.
 *
 * `canOperate` is re-derived every render rather than stored: operatorship is a
 * fact about who is connected *now*, and a stored flag would survive the user
 * switching to an account that no longer holds it.
 *
 * It is derived from the validator address rather than from the `operator`
 * field, because the two can disagree in the user's favour — a validator added
 * by searching carries no `operator`, yet the wallet on screen may well be the
 * one that runs it. The chain answers that question from the address alone, and
 * so does this.
 */
export function useActiveValidator(): ActiveValidator | undefined {
  const activeValoper = useAccounts((state) => state.activeValoper)
  const accounts = useAccounts((state) => state.accounts)
  const address = useWallet((state) => state.address)

  const account = accounts.find((a) => a.valoper === activeValoper)
  if (!account) return undefined

  const operator = toOperatorAddress(account.valoper)
  return { account, canOperate: Boolean(operator) && operator === address }
}

/**
 * The address the dashboard is currently acting *as*.
 *
 * In validator mode that is the validator's own account, not the wallet holding
 * the screen — which is what makes governance show the validator's vote rather
 * than the operator's personal one. Outside it, the two are the same thing.
 *
 * Deliberately free of any chain query, so read-only screens can ask who they
 * are looking at without waiting on a grant lookup.
 */
export function useActingAddress(): string | undefined {
  const active = useActiveValidator()
  const address = useWallet((state) => state.address)

  if (!active) return address
  return toOperatorAddress(active.account.valoper)
}

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { toOperatorAddress } from '@/lib/validator'
import { useWallet } from '@/store/wallet'

/**
 * Accounts the dashboard can act *as*, beyond the connected wallet.
 *
 * Two kinds, and they are different in one important way. A validator is not a
 * second key — it is the same wallet wearing a different hat, so nothing here
 * holds a signer and "may I act" is answered by comparing addresses. A
 * multisig *is* a different account, one no single key controls: the wallet on
 * screen may be one of its members, which entitles it to propose and to sign,
 * but never to act alone.
 *
 * What this store holds either way is which hat is on, which is what lets the
 * shell swap its navigation and feel like an account switch rather than a page.
 *
 * Kept apart from `useWallet` on purpose: the wallet store owns a live
 * connection and is rebuilt whenever the extension changes account, while this
 * is a list the user curated and expects to find again after a reload.
 */

export type AccountKind = 'validator' | 'multisig'

export interface LinkedValidator {
  kind: 'validator'
  /** The valoper, which is also this account's id. */
  id: string
  valoper: string
  moniker: string
  /**
   * Keybase identity, stored so the switcher can show the validator's own
   * picture without first querying the chain for it.
   *
   * Three states, not two. A string is an identity to look up; the empty
   * string means the chain was asked and this validator published none;
   * `undefined` means nobody has asked yet, which is where accounts added
   * before this was recorded start. Collapsing the last two would either
   * re-query every render forever or leave those accounts on the generated
   * avatar for good.
   */
  identity?: string
  /**
   * The `secret1…` account that operates this validator, when the wallet
   * proved it by being that account. Absent for one added by searching, which
   * is a bookmark rather than a login — the difference between the two is
   * exactly what unlocks the operations card.
   */
  operator?: string
}

export interface LinkedMultisig {
  kind: 'multisig'
  /** The account address, which is also this account's id. */
  id: string
  address: string
  label: string
  /** Shown beside the address so a member can confirm the same account. */
  fingerprint: string
  threshold: number
  memberCount: number
}

export type LinkedAccount = LinkedValidator | LinkedMultisig

/** What to call an account, whichever kind it is. */
export function displayName(account: LinkedAccount): string {
  return account.kind === 'validator' ? account.moniker : account.label
}

/** The `secret1…` this account acts as. */
export function accountAddress(account: LinkedAccount): string | undefined {
  return account.kind === 'validator' ? toOperatorAddress(account.valoper) : account.address
}

interface AccountsState {
  accounts: LinkedAccount[]
  /** `undefined` is the ordinary wallet view. */
  activeId?: string

  add: (account: LinkedAccount) => void
  remove: (id: string) => void
  /** Records what the chain says, including that there is nothing to record. */
  setIdentity: (id: string, identity: string) => void
  setActive: (id: string) => void
  clearActive: () => void
}

export const useAccounts = create<AccountsState>()(
  persist(
    (set, get) => ({
      accounts: [],

      add: (account) => {
        const rest = get().accounts.filter((a) => a.id !== account.id)
        // Re-adding after proving operatorship should promote the bookmark, so
        // the new entry replaces the old rather than being refused as a dupe.
        set({ accounts: [...rest, account], activeId: account.id })
      },

      remove: (id) =>
        set((state) => ({
          accounts: state.accounts.filter((a) => a.id !== id),
          activeId: state.activeId === id ? undefined : state.activeId
        })),

      setIdentity: (id, identity) =>
        set((state) => ({
          accounts: state.accounts.map((a) =>
            a.id === id && a.kind === 'validator' ? { ...a, identity } : a
          )
        })),

      setActive: (id) => set({ activeId: id }),
      clearActive: () => set({ activeId: undefined })
    }),
    {
      name: 'secret-dashboard:accounts',
      version: 2,
      /**
       * The list is the user's. Which one was open is this session's — except
       * for a multisig, which survives a reload.
       *
       * The asymmetry is deliberate. Validator mode is the same wallet looking
       * at itself from another angle, and landing back on the wallet screen
       * after a reload loses nothing. A multisig is a different account with
       * its own screens and its own links: a member sent a link to a proposal
       * would otherwise open it, be bounced to the wallet, and have no way of
       * knowing why.
       */
      partialize: (state) => {
        const active = state.accounts.find((account) => account.id === state.activeId)
        return {
          accounts: state.accounts,
          activeId: active?.kind === 'multisig' ? active.id : undefined
        }
      },
      /**
       * Version 1 stored validators keyed by `valoper` with no `id` and no
       * `kind` discriminant worth the name. Nobody should lose their list to a
       * refactor, so those entries are carried forward rather than dropped.
       */
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as { accounts?: unknown }
        if (version >= 2) return state as { accounts: LinkedAccount[] }

        const accounts = Array.isArray(state.accounts) ? state.accounts : []
        return {
          accounts: accounts
            .map((entry) => entry as Record<string, unknown>)
            .filter((entry) => typeof entry.valoper === 'string')
            .map((entry) => ({
              kind: 'validator' as const,
              id: entry.valoper as string,
              valoper: entry.valoper as string,
              moniker: typeof entry.moniker === 'string' ? entry.moniker : (entry.valoper as string),
              identity: typeof entry.identity === 'string' ? entry.identity : undefined,
              operator: typeof entry.operator === 'string' ? entry.operator : undefined
            }))
        }
      },
      merge: (persisted, current) => ({ ...current, ...(persisted as Partial<AccountsState>) })
    }
  )
)

/**
 * Leave the account when the wallet behind it changes.
 *
 * Subscribed here rather than called from `useWallet` so the dependency runs
 * one way only. Disconnecting or switching account in the extension means the
 * screen is no longer being driven by whoever proved operatorship — or by a
 * member of the multisig — and a shell that kept that navigation would be
 * claiming an authority the new account may not have. The list itself
 * survives; only the open one closes.
 */
useWallet.subscribe((state, previous) => {
  if (state.address !== previous.address) useAccounts.getState().clearActive()
})

/* -------------------------------------------------------------------------- */
/* Which hat is on                                                             */
/* -------------------------------------------------------------------------- */

export type ActingMode = 'wallet' | 'validator' | 'multisig'

export interface ActiveValidator {
  account: LinkedValidator
  /** The wallet on screen is the one that operates it, so it may sign for it. */
  canOperate: boolean
}

/** Whichever account the shell is currently wearing, of either kind. */
export function useActiveAccount(): LinkedAccount | undefined {
  const activeId = useAccounts((state) => state.activeId)
  const accounts = useAccounts((state) => state.accounts)
  return accounts.find((account) => account.id === activeId)
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
  const account = useActiveAccount()
  const address = useWallet((state) => state.address)

  if (account?.kind !== 'validator') return undefined

  const operator = toOperatorAddress(account.valoper)
  return { account, canOperate: Boolean(operator) && operator === address }
}

export interface ActiveMultisig {
  account: LinkedMultisig
  /**
   * The wallet on screen is one of its members.
   *
   * Derived here from the stored member count only in the negative sense — the
   * real answer needs the member list, which lives in `useMultisig`. This is
   * the cheap half: which account is open, and its address.
   */
  address: string
}

export function useActiveMultisig(): ActiveMultisig | undefined {
  const account = useActiveAccount()
  if (account?.kind !== 'multisig') return undefined
  return { account, address: account.address }
}

export function useActingMode(): ActingMode {
  const account = useActiveAccount()
  return account?.kind ?? 'wallet'
}

/**
 * The address the dashboard is currently acting *as*.
 *
 * In validator mode that is the validator's own account, not the wallet
 * holding the screen — which is what makes governance show the validator's
 * vote rather than the operator's personal one. In multisig mode it is the
 * multisig. Outside both, it is the wallet.
 *
 * Deliberately free of any chain query, so read-only screens can ask who they
 * are looking at without waiting on a grant lookup.
 */
export function useActingAddress(): string | undefined {
  const account = useActiveAccount()
  const address = useWallet((state) => state.address)

  if (!account) return address
  return accountAddress(account) ?? address
}

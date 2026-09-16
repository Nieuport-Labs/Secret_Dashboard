import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { CHAIN_ID } from '@/chains/secret4'

/**
 * Viewing keys, for the accounts that cannot use a permit.
 *
 * Only multisigs need this. An ordinary account signs a permit and stores no
 * secret at all; a multisig cannot, because a permit is verified by recovering
 * one public key and a group signature has none. So the group sets a key at
 * the token contract with a transaction they all sign, and everyone keeps a
 * copy of it.
 *
 * Three things about that are worth saying plainly wherever this is used, and
 * none of them are fixable by better storage:
 *
 * - it is a **shared secret**. Anyone holding it can read the balance, member
 *   or not;
 * - it **outlives membership**. Removing someone from the group does not take
 *   their copy away, so a member leaving means rotating the key — which is
 *   another transaction the remaining members have to sign;
 * - it is **per contract**. A key is stored by the token, so reading a new
 *   token means another transaction.
 *
 * One key per account rather than one per token, which is what wallets do and
 * what people expect. It makes rotation a single decision instead of a dozen.
 */

export interface AccountKeys {
  key: string
  /** Contracts the key is known to have been set on — the ones worth querying. */
  contracts: string[]
}

interface ViewingKeyState {
  /** By chain and account, so two chains' keys can never be confused. */
  byAccount: Record<string, AccountKeys>

  setKey: (owner: string, key: string) => void
  recordContracts: (owner: string, contracts: string[]) => void
  forget: (owner: string) => void
}

function keyFor(owner: string): string {
  return `${CHAIN_ID}:${owner}`
}

export const useViewingKeys = create<ViewingKeyState>()(
  persist(
    (set, get) => ({
      byAccount: {},

      setKey: (owner, key) => {
        const existing = get().byAccount[keyFor(owner)]
        set({
          byAccount: {
            ...get().byAccount,
            // A new key invalidates every contract the old one was set on:
            // until each is updated on chain, the old key is what those
            // contracts still hold, and listing them would read as "this key
            // works here" when it does not.
            [keyFor(owner)]: { key, contracts: existing?.key === key ? existing.contracts : [] }
          }
        })
      },

      recordContracts: (owner, contracts) => {
        const existing = get().byAccount[keyFor(owner)]
        if (!existing) return
        const merged = [...new Set([...existing.contracts, ...contracts])]
        set({ byAccount: { ...get().byAccount, [keyFor(owner)]: { ...existing, contracts: merged } } })
      },

      forget: (owner) => {
        const rest = Object.fromEntries(
          Object.entries(get().byAccount).filter(([entry]) => entry !== keyFor(owner))
        )
        set({ byAccount: rest })
      }
    }),
    {
      name: 'secret-dashboard:viewing-keys',
      version: 1,
      partialize: (state) => ({ byAccount: state.byAccount })
    }
  )
)

export function useAccountKeys(owner: string | undefined): AccountKeys | undefined {
  return useViewingKeys((state) => (owner ? state.byAccount[keyFor(owner)] : undefined))
}

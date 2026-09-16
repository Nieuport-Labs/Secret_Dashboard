import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import {
  assertDerives,
  fingerprintOf,
  isMember,
  memberByAddress,
  type MultisigConfig,
  type MultisigMember
} from '@/lib/multisig/config'
import { useAccounts, useActiveAccount } from '@/store/accounts'
import { useWallet } from '@/store/wallet'

/**
 * The multisig accounts this browser knows about.
 *
 * A configuration is not a secret and not an authority — it is a list of
 * public keys and a threshold, and anyone holding it can compute the address
 * and check any transaction claiming to come from it. What it *is* is hard to
 * reconstruct from memory, which is why it is kept, and why the app offers to
 * export it: a member who loses this list has lost nothing cryptographic but
 * has lost the ability to check anything.
 *
 * `accounts.ts` holds the switcher's entry for each of these — name, threshold,
 * how many members — and this store holds the keys themselves. The split keeps
 * the switcher cheap to render and means an account cannot appear in the rail
 * without the configuration that proves what it is.
 */

interface MultisigState {
  /** By address, which is the only identifier the chain agrees with. */
  configs: Record<string, MultisigConfig>

  save: (config: MultisigConfig) => void
  forget: (address: string) => void
  rename: (address: string, label: string) => void
}

export const useMultisig = create<MultisigState>()(
  persist(
    (set, get) => ({
      configs: {},

      save: (config) => {
        // Re-derived before it is kept, not only when it was imported: a
        // configuration that reaches this store wrong would have every later
        // check measuring against the wrong account.
        assertDerives(config)
        set({ configs: { ...get().configs, [config.address]: config } })
      },

      forget: (address) => {
        const rest = Object.fromEntries(Object.entries(get().configs).filter(([key]) => key !== address))
        set({ configs: rest })
      },

      rename: (address, label) => {
        const config = get().configs[address]
        if (!config) return
        set({ configs: { ...get().configs, [address]: { ...config, label: label.trim() } } })
      }
    }),
    {
      name: 'secret-dashboard:multisig',
      version: 1,
      partialize: (state) => ({ configs: state.configs })
    }
  )
)

/**
 * Drop the switcher entry when the configuration behind it goes.
 *
 * The two stores are separate but the rail entry is meaningless without the
 * keys: it would offer an account whose transactions could not be checked.
 */
export function forgetMultisig(address: string): void {
  useMultisig.getState().forget(address)
  useAccounts.getState().remove(address)
}

/** Save the configuration and put the account in the switcher, in one step. */
export function adoptMultisig(config: MultisigConfig): void {
  useMultisig.getState().save(config)
  useAccounts.getState().add({
    kind: 'multisig',
    id: config.address,
    address: config.address,
    label: config.label,
    fingerprint: fingerprintOf(config),
    threshold: config.threshold,
    memberCount: config.members.length
  })
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

export function useMultisigConfig(address: string | undefined): MultisigConfig | undefined {
  return useMultisig((state) => (address ? state.configs[address] : undefined))
}

export function useMultisigConfigs(): MultisigConfig[] {
  const configs = useMultisig((state) => state.configs)
  return Object.values(configs)
}

/** The configuration for the account the shell is currently wearing. */
export function useActiveMultisigConfig(): MultisigConfig | undefined {
  const account = useActiveAccount()
  return useMultisigConfig(account?.kind === 'multisig' ? account.address : undefined)
}

export interface Membership {
  /** The connected wallet is one of the members. */
  isMember: boolean
  /** Which member it is, when it is one. */
  member?: MultisigMember
}

/**
 * Whether the wallet on screen may sign for this account.
 *
 * Re-derived every render rather than stored, for the same reason a
 * validator's `canOperate` is: membership is a fact about who is connected
 * *now*, and a remembered answer would survive switching to a key that is not
 * in the set.
 *
 * Matched by address rather than by public key. The two are equivalent — an
 * address is a hash of a key — and the address is the part the wallet gives us
 * without being asked.
 */
export function useMembership(config: MultisigConfig | undefined): Membership {
  const address = useWallet((state) => state.address)

  if (!config || !address) return { isMember: false }
  return { isMember: isMember(config, address), member: memberByAddress(config, address) }
}

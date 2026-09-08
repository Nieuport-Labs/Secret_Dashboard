import { create } from 'zustand'

import { GAS_PRICE_USCRT, GAS_VAULT_ADDRESS } from '@/chains/secret4'
import { resolveLcdUrl } from '@/lib/endpoint'
import {
  availableFee,
  estimateFee,
  fetchFeeGrants,
  selectFeeGrant,
  type FeeGrant,
  type Selection
} from '@/lib/feegrant-sdk'
import { errorMessage } from '@/lib/errors'
import { useSettings } from '@/store/settings'
import { useWallet } from '@/store/wallet'

/**
 * Who pays for a transaction.
 *
 * This is the only place that decides. Every transaction the app sends passes
 * its gas limit and message types through `granterFor`, so the preference in
 * Settings applies everywhere and there is no second place to update when it
 * changes.
 *
 * Two things this cannot do, which the UI has to be honest about:
 *
 * - **A grant is never applied automatically.** The transaction must set
 *   `auth_info.fee.granter` itself; wallets do not fill it in. That is exactly
 *   what `granterFor` returns, and forgetting to pass it means the sender pays.
 * - **The chain re-checks at execution.** A grant can be revoked or drained
 *   between the query and the broadcast, so rejection is a normal outcome to
 *   fall back from, not an error to report.
 */

interface FeePayerState {
  /** Grants the connected wallet may spend against. */
  grants: FeeGrant[]
  loading: boolean
  error?: string

  refresh: () => Promise<void>
  /** Full decision, including why a grant was rejected and what else could pay. */
  resolve: (gasLimit: number, msgTypeUrls: string[]) => Selection
  /** Just the granter address, for passing straight into a transaction's options. */
  granterFor: (gasLimit: number, msgTypeUrls: string[]) => string | undefined
}

export const useFeePayer = create<FeePayerState>()((set, get) => ({
  grants: [],
  loading: false,

  refresh: async () => {
    const address = useWallet.getState().address
    if (!address) {
      set({ grants: [], error: undefined })
      return
    }

    set({ loading: true, error: undefined })
    try {
      const lcd = await resolveLcdUrl(useSettings.getState().lcdOverride)
      set({ grants: await fetchFeeGrants(lcd, address), loading: false })
    } catch (error) {
      // No grants readable is not the same as no grants existing, so the
      // reason is kept rather than collapsing to an empty list.
      set({
        grants: [],
        loading: false,
        error: errorMessage(error)
      })
    }
  },

  resolve: (gasLimit, msgTypeUrls) => {
    const { feeMode, feeGranter } = useSettings.getState()
    return selectFeeGrant(get().grants, {
      mode: feeMode,
      granter: feeGranter || undefined,
      // The same gas price the signing library is given. An estimate below what
      // is actually charged is the one way to have a grant judged able to cover
      // a transaction it then fails.
      fee: estimateFee(gasLimit, GAS_PRICE_USCRT),
      msgTypeUrls
    })
  },

  granterFor: (gasLimit, msgTypeUrls) => get().resolve(gasLimit, msgTypeUrls).granter
}))

/**
 * What the gas vault still covers for this account, in base units.
 *
 * `undefined` means the vault has issued nothing here — distinct from a grant
 * that exists and is empty, which reads as 0.
 */
export function vaultCredit(grants: FeeGrant[]): bigint | undefined {
  const grant = grants.find((g) => g.granter === GAS_VAULT_ADDRESS)
  if (!grant) return undefined
  return availableFee(grant) ?? 0n
}

/** Roughly how many transactions a credit balance covers, at a typical gas limit. */
export function transactionsCovered(credit: bigint, typicalGas = 150_000): number {
  const perTransaction = BigInt(estimateFee(typicalGas, GAS_PRICE_USCRT))
  if (perTransaction === 0n) return 0
  return Number(credit / perTransaction)
}

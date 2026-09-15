import { createContext, useContext } from 'react'

import type { ActivityEntry } from '@/lib/activity'
import type { Permit } from '@/lib/permit'
import type { Balances } from '@/hooks/useBalances'
import type { Derivative } from '@/hooks/useDerivative'
import type { NativeUnbondings } from '@/hooks/useNativeUnbondings'
import type { PushStatus } from '@/hooks/useArrivals'

/**
 * Everything read on behalf of the connected account, in one place.
 *
 * These used to be four hooks owned by the wallet screen, which was fine while
 * the wallet screen was the only thing that showed them. It no longer is: the
 * header carries the push indicator and the sweep on every page, and a sweep
 * that only runs where the balances are listed is a sweep that has not run.
 * Reading them once above the router also means switching pages does not tear
 * down the permit, the subscriptions and the balances and pay for them again.
 */
export interface WalletData {
  /** The signed query permit, once there is one. */
  permit?: Permit
  /** Registry tokens the permit predates and therefore cannot read. */
  staleTokens: string[]
  signing: boolean
  permitError?: string
  sign: () => void

  balances: Balances
  activity: {
    entries: ActivityEntry[]
    loading: boolean
    unreadable: number
    publicError?: string
    refresh: () => void
  }
  /**
   * The second permit, covering Shade's staking derivative alone. Separate
   * because that contract's permissions are not the standard ones, so asking
   * for them in the registry-wide permit breaks every other token.
   */
  stakingPermit: {
    signed: boolean
    signing: boolean
    error?: string
    sign: () => void
  }
  /** The account's position in Shade's staking derivative — see `derivative.ts`. */
  derivative: Derivative
  /** Plain SCRT undelegating from validators. Public queries, no permit. */
  nativeUnbondings: NativeUnbondings
  /** Whether arrivals appear the instant they happen. */
  pushStatus: PushStatus
  /** Re-read balances and activity together. */
  refreshAll: () => void
}

export const WalletDataContext = createContext<WalletData | undefined>(undefined)

/**
 * The account's data, from the provider in the shell.
 *
 * Throws rather than handing back a hollow default: every caller is inside the
 * shell, so a missing provider is a wiring mistake, and a default would hide it
 * behind a screen that simply never fills in.
 */
export function useWalletData(): WalletData {
  const value = useContext(WalletDataContext)
  if (!value) throw new Error('useWalletData must be used inside the app shell')
  return value
}

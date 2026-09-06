import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { GAS_SLICE_USD } from '@/chains/osmosis'
import type { GasDelivery } from '@/lib/getGas'

/**
 * User preferences, persisted locally.
 *
 * Everything here is a choice the user made and expects to survive a reload.
 * Nothing derived from the chain belongs in it.
 */

export type Theme = 'dark' | 'light'

/** Who pays transaction fees. Mirrors the fee-grant SDK's `SelectionMode`. */
export type FeeMode =
  /** Spend the best usable grant whenever one covers the fee. */
  | 'auto'
  /** Always use the grant named in `feeGranter`. */
  | 'select'
  /** Never spend a grant, even when one is usable. */
  | 'off'

interface SettingsState {
  theme: Theme
  currency: string

  feeMode: FeeMode
  /** Granter address for `feeMode: 'select'`. */
  feeGranter: string

  /** Comma-separated overrides. Empty means use the built-in candidates. */
  lcdOverride: string
  rpcOverride: string

  /** SNIP-52 push. Off falls back to polling, which always works. */
  notificationsEnabled: boolean
  /** Skip the "do you want to wrap it?" prompt and just wrap. */
  autoWrapDeposits: boolean
  /** Size of the gas slice taken at bridge time, in USD. */
  gasSliceUsd: number
  /**
   * What the gas slice turns into on arrival. 'native' lands spendable SCRT and
   * depends on nothing but the swap; 'credits' lands a vault fee allowance and
   * additionally depends on an IBC hook whose interaction with Osmosis's own
   * callback key has not been settled by a live packet. Hence the default.
   */
  gasDelivery: GasDelivery

  set: <K extends keyof SettingsValues>(key: K, value: SettingsValues[K]) => void
  reset: () => void
}

type SettingsValues = Omit<SettingsState, 'set' | 'reset'>

const DEFAULTS: SettingsValues = {
  theme: 'dark',
  currency: 'USD',
  feeMode: 'auto',
  feeGranter: '',
  lcdOverride: '',
  rpcOverride: '',
  notificationsEnabled: true,
  autoWrapDeposits: false,
  gasSliceUsd: GAS_SLICE_USD,
  gasDelivery: 'native'
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      set: (key, value) => set({ [key]: value } as Partial<SettingsState>),
      reset: () => set(DEFAULTS)
    }),
    {
      name: 'secret-dashboard:settings',
      // A stored setting from an older shape must not wipe the new defaults.
      merge: (persisted, current) => ({ ...current, ...(persisted as Partial<SettingsValues>) })
    }
  )
)

/** Keeps the document class in step with the theme setting. */
export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('light', theme === 'light')
}

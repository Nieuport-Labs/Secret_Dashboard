import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import type { Preferences, SignedPreferencesRecord } from '@/lib/preferencesRecord'
import { fetchPreferences, sendPreferences } from '@/lib/preferencesServer'

/**
 * The first-run answers, per account.
 *
 * The server (`api/preferences.ts`) is where they live; this is the copy that
 * lets a reload skip the round trip, and the outbox for a signed record the
 * server could not take yet — an account the chain has never seen is refused
 * there, and a brand-new account is exactly who answers these questions. The
 * record is already signed, so sending it again later needs no second prompt.
 */

interface Entry {
  preferences: Preferences
  signedAt: number
  /** Signed, not yet on the server. */
  unsent?: SignedPreferencesRecord
}

interface PreferencesState {
  byAddress: Record<string, Entry>
  remember: (address: string, entry: Entry) => void
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      byAddress: {},
      remember: (address, entry) => set((state) => ({ byAddress: { ...state.byAddress, [address]: entry } }))
    }),
    { name: 'secret-dashboard:preferences' }
  )
)

/** The account's answers, or `undefined` while they have not been given. */
export function usePreferences(address: string | undefined): Preferences | undefined {
  return usePreferencesStore((state) => (address ? state.byAddress[address]?.preferences : undefined))
}

/**
 * Bring this device and the server into line for one account, and say whether
 * the questions still need asking.
 *
 * The newer copy wins either way. A server that cannot be reached is treated
 * as holding nothing — asking a question twice is a smaller harm than never
 * asking it — unless this device already has an answer.
 */
export async function syncPreferences(address: string): Promise<'answered' | 'unanswered'> {
  const { byAddress, remember } = usePreferencesStore.getState()
  const local = byAddress[address]

  let server: Awaited<ReturnType<typeof fetchPreferences>>
  try {
    server = await fetchPreferences(address)
  } catch {
    return local ? 'answered' : 'unanswered'
  }

  if (server && (!local || server.body.signedAt >= local.signedAt)) {
    remember(address, { preferences: server.body.preferences, signedAt: server.body.signedAt })
    return 'answered'
  }

  if (local?.unsent) {
    try {
      await sendPreferences(local.unsent)
      remember(address, { preferences: local.preferences, signedAt: local.signedAt })
    } catch {
      // Still refused (most likely not on chain yet). Kept for next time.
    }
  }

  return local ? 'answered' : 'unanswered'
}

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { errorMessage } from '@/lib/errors'
import { SYNCED_KEYS, type AssetMode, type GasMode, type SyncedSettings } from '@/lib/settingsRecord'
import {
  authorizeDevice,
  canAuthorizeDevice,
  fetchSettings,
  hasDeviceKey,
  pushSettings,
  SettingsSyncError
} from '@/lib/settingsSync'
import type { WalletId } from '@/lib/wallet'
import { useSettings, type SettingsValues } from '@/store/settings'

/**
 * Keeps `useSettings` and the connected account's copy on the server in step.
 *
 * The rules, in the order they are checked when an account connects:
 *
 * - The local settings belong to one account at a time, `owner`. Connecting a
 *   different one takes that account's settings from the server; nothing made
 *   under one account is ever written to another's.
 * - For the same account, the newer side wins — `changedAt` here against
 *   `signedAt` there — so a change made offline is sent when it can be, and a
 *   change made on another device is taken.
 * - An account with nothing on the server has not answered the first-run
 *   questions; `needsAnswers` says so and the onboarding dialog asks them.
 *
 * After that, every change to a synced setting is pushed a moment later,
 * signed by this device's key, with no wallet prompt. A device without a key
 * keeps its changes locally and says so in Settings, where one prompt fixes it.
 */

export type SyncStatus =
  | 'idle'
  | 'syncing'
  | 'synced'
  /** This device has no key for the account; changes stay here until it does. */
  | 'unauthorized'
  /** The wallet cannot sign messages, so this device can never sync. */
  | 'unsupported'
  /** The server refuses accounts the chain has not seen; retried on the next visit. */
  | 'not-on-chain'
  | 'offline'
  | 'error'

interface SyncState {
  /** The account the local settings belong to. Persisted. */
  owner: string | undefined
  /** When a synced setting last changed here, in ms. Persisted. */
  changedAt: number

  /** The connected account being synced, if any. */
  address: string | undefined
  status: SyncStatus
  message: string | undefined
  /** The connected account has not answered the first-run questions. */
  needsAnswers: boolean
}

export const useSettingsSync = create<SyncState>()(
  persist(
    () => ({
      owner: undefined as string | undefined,
      changedAt: 0,
      address: undefined as string | undefined,
      status: 'idle' as SyncStatus,
      message: undefined as string | undefined,
      needsAnswers: false as boolean
    }),
    {
      name: 'secret-dashboard:settings-sync',
      partialize: (state) => ({ owner: state.owner, changedAt: state.changedAt })
    }
  )
)

const set = useSettingsSync.setState
const get = useSettingsSync.getState

/** The synced slice of the local settings, or `undefined` before the questions are answered. */
function snapshot(): SyncedSettings | undefined {
  const settings = useSettings.getState()
  if (!settings.gasMode || !settings.assetMode) return undefined
  const picked = Object.fromEntries(SYNCED_KEYS.map((key) => [key, settings[key]]))
  return picked as unknown as SyncedSettings
}

function answered(): boolean {
  return snapshot() !== undefined
}

/** Set while the server's copy is being written in, so it is not mistaken for a local change. */
let applying = false

function apply(settings: SyncedSettings): void {
  applying = true
  try {
    useSettings.setState(settings satisfies Partial<SettingsValues>)
  } finally {
    applying = false
  }
}

async function push(address: string): Promise<void> {
  const settings = snapshot()
  if (!settings || get().address !== address) return
  if (!hasDeviceKey(address)) {
    set({ status: 'unauthorized', message: undefined })
    return
  }

  set({ status: 'syncing', message: undefined })
  try {
    await pushSettings(address, settings, get().changedAt)
    if (get().address === address) set({ status: 'synced' })
  } catch (error) {
    if (get().address !== address) return
    const status = error instanceof SettingsSyncError ? error.status : 0
    set({
      status: status === 403 ? 'not-on-chain' : status === 401 || status === 0 ? 'unauthorized' : 'error',
      message: errorMessage(error)
    })
  }
}

let timer: ReturnType<typeof setTimeout> | undefined

function schedulePush(address: string): void {
  clearTimeout(timer)
  // A burst of changes — typing a number, flipping twice — is one write.
  timer = setTimeout(() => void push(address), 800)
}

/**
 * Watch the local settings for changes worth syncing. Called once, by the
 * shell; returns the unsubscribe.
 */
export function watchSettings(): () => void {
  return useSettings.subscribe((next, previous) => {
    if (applying) return
    if (!SYNCED_KEYS.some((key) => next[key] !== previous[key])) return

    const { address, needsAnswers } = get()
    // A change made while an account is connected is that account's. One made
    // signed out stays with whoever owned the settings, and goes up when they
    // are back.
    if (address && !needsAnswers) {
      set({ owner: address, changedAt: Date.now() })
      schedulePush(address)
    } else {
      set({ changedAt: Date.now() })
    }
  })
}

/** An account connected, or the connection went away (`undefined`). */
export async function connectSettings(address: string | undefined): Promise<void> {
  clearTimeout(timer)
  set({ address, status: 'idle', message: undefined, needsAnswers: false })
  if (!address) return

  set({ status: 'syncing' })
  let server: Awaited<ReturnType<typeof fetchSettings>>
  try {
    server = await fetchSettings(address)
  } catch (error) {
    if (get().address !== address) return
    // Asking twice is a smaller harm than never asking; answers already given
    // on this device for this account stand.
    set({
      status: 'offline',
      message: errorMessage(error),
      needsAnswers: !(get().owner === address && answered())
    })
    return
  }
  if (get().address !== address) return

  const { owner, changedAt } = get()

  if (server && (owner !== address || server.signedAt >= changedAt)) {
    apply(server.settings)
    set({ owner: address, changedAt: server.signedAt, status: 'synced' })
    return
  }

  if (owner === address && answered()) {
    // Newer here than there, or not there at all yet (refused last time).
    await push(address)
    return
  }

  set({ status: 'idle', needsAnswers: true })
}

/**
 * The onboarding dialog's last step: authorise this device (one wallet prompt)
 * and store the answers along with every other synced setting.
 *
 * Throws only when the wallet refuses to sign, so the dialog can say so and
 * stay open. A wallet that cannot sign at all keeps the answers on this device.
 */
export async function completeOnboarding(
  walletId: WalletId,
  address: string,
  answers: { gasMode: GasMode; assetMode: AssetMode }
): Promise<void> {
  const supported = canAuthorizeDevice(walletId)
  if (supported && !hasDeviceKey(address)) await authorizeDevice(walletId, address)

  set({ needsAnswers: false, owner: address })
  applying = true
  try {
    useSettings.setState(answers)
  } finally {
    applying = false
  }
  set({ changedAt: Date.now() })

  if (!supported) {
    set({ status: 'unsupported', message: undefined })
    return
  }
  await push(address)
}

/** "Turn on sync" in Settings: one wallet prompt, then send what is here. */
export async function authorizeAndSync(walletId: WalletId, address: string): Promise<void> {
  try {
    await authorizeDevice(walletId, address)
  } catch (error) {
    set({ status: 'unauthorized', message: errorMessage(error) })
    return
  }
  set({ owner: address })
  await push(address)
}

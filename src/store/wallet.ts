import type { SecretNetworkClient } from 'secretjs'
import { create } from 'zustand'

import { CHAIN_ID } from '@/chains/secret4'
import { forgetCodeHashes } from '@/lib/codeHash'
import { describeNetworkError, resolveLcdUrl } from '@/lib/endpoint'
import { connect, WalletNotInstalledError, type Connection, type WalletId } from '@/lib/wallet'
import { useSettings } from '@/store/settings'

/**
 * The connected wallet, and the secretjs client built from it.
 *
 * One store rather than a provider chain, so nothing needs to be mounted in a
 * particular order for a transaction to know who is signing. The invariant that
 * matters is that there is exactly one place holding this, and there is.
 */

export type WalletStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

interface WalletState {
  status: WalletStatus
  walletId?: WalletId
  address?: string
  accountName?: string
  /** Signing client. Present only while connected. */
  client?: SecretNetworkClient
  /** Read-only client, available before anyone connects. */
  queryClient?: SecretNetworkClient
  error?: string
  /** True when the failure was "no such extension", which needs an install link. */
  notInstalled?: boolean

  connectWallet: (id: WalletId) => Promise<void>
  disconnect: () => void
  /** Build the read-only client, so balances and stats work while signed out. */
  initQueryClient: () => Promise<void>
}

const LAST_WALLET_KEY = 'secret-dashboard:last-wallet'

function rememberWallet(id: WalletId | undefined): void {
  try {
    if (id) localStorage.setItem(LAST_WALLET_KEY, id)
    else localStorage.removeItem(LAST_WALLET_KEY)
  } catch {
    // Reconnecting automatically next time is a convenience, not a requirement.
  }
}

export function lastUsedWallet(): WalletId | undefined {
  try {
    const value = localStorage.getItem(LAST_WALLET_KEY)
    return value === 'keplr' || value === 'starshell' ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * secretjs is ~3MB once its protobuf dependencies are counted, and the welcome
 * screen needs none of it: choosing a wallet is pure DOM. Loading it on demand
 * keeps the first paint off that download, which matters most for exactly the
 * newcomer this dashboard exists to onboard.
 *
 * The promise is cached, so the module is fetched once however many callers ask.
 */
let secretjs: Promise<typeof import('secretjs')> | undefined
function loadSecretjs(): Promise<typeof import('secretjs')> {
  secretjs ??= import('secretjs')
  return secretjs
}

async function buildQueryClient(url: string): Promise<SecretNetworkClient> {
  const { SecretNetworkClient } = await loadSecretjs()
  return new SecretNetworkClient({ url, chainId: CHAIN_ID })
}

async function buildSigningClient(url: string, connection: Connection): Promise<SecretNetworkClient> {
  const { SecretNetworkClient } = await loadSecretjs()
  return new SecretNetworkClient({
    url,
    chainId: CHAIN_ID,
    wallet: connection.signer as never,
    walletAddress: connection.address,
    encryptionUtils: connection.encryptionUtils as never
  })
}

export const useWallet = create<WalletState>()((set, get) => ({
  status: 'disconnected',

  initQueryClient: async () => {
    if (get().queryClient) return
    const url = await resolveLcdUrl(useSettings.getState().lcdOverride)
    set({ queryClient: await buildQueryClient(url) })
  },

  connectWallet: async (id) => {
    set({ status: 'connecting', error: undefined, notInstalled: undefined })
    try {
      const [url, connection] = await Promise.all([
        resolveLcdUrl(useSettings.getState().lcdOverride),
        connect(id)
      ])

      const client = await buildSigningClient(url, connection)

      set({
        status: 'connected',
        walletId: id,
        address: connection.address,
        accountName: connection.accountName,
        client,
        queryClient: get().queryClient ?? (await buildQueryClient(url)),
        error: undefined,
        notInstalled: undefined
      })
      rememberWallet(id)
    } catch (error) {
      set({
        status: 'error',
        error: error instanceof WalletNotInstalledError ? error.message : describeNetworkError(error),
        notInstalled: error instanceof WalletNotInstalledError
      })
    }
  },

  disconnect: () => {
    rememberWallet(undefined)
    // Code hashes are chain facts, not account facts, so they survive. Anything
    // keyed by address does not.
    set({
      status: 'disconnected',
      walletId: undefined,
      address: undefined,
      accountName: undefined,
      client: undefined,
      error: undefined,
      notInstalled: undefined
    })
  }
}))

/**
 * Drop everything keyed by the account and reconnect.
 *
 * The wallet fires this when the user switches account or network. From that
 * moment every balance, permit and fee grant on screen belongs to someone else,
 * so reconnecting is the only correct response.
 */
export function handleAccountChange(): void {
  const { walletId, connectWallet, disconnect } = useWallet.getState()
  forgetCodeHashes()
  if (walletId) void connectWallet(walletId)
  else disconnect()
}

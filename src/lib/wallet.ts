/**
 * Wallet discovery and connection: Keplr and StarShell.
 *
 * Both expose the same injected API, so the app talks to one interface and only
 * the discovery differs. A minimal structural type is declared here rather than
 * pulling in `@keplr-wallet/types`, so that what the app actually depends on is
 * visible in one place.
 */

import { CHAIN_ID } from '@/chains/secret4'

/* -------------------------------------------------------------------------- */
/* The injected API, narrowed to what this app uses                            */
/* -------------------------------------------------------------------------- */

export interface AminoSignDoc {
  chain_id: string
  account_number: string
  sequence: string
  fee: { amount: Array<{ denom: string; amount: string }>; gas: string }
  msgs: Array<{ type: string; value: unknown }>
  memo: string
}

export interface AminoSignResponse {
  signed: AminoSignDoc
  signature: { pub_key: { type: string; value: string }; signature: string }
}

export interface OfflineSigner {
  getAccounts(): Promise<Array<{ address: string; algo: string; pubkey: Uint8Array }>>
}

export interface KeplrLike {
  enable(chainId: string): Promise<void>
  getKey(chainId: string): Promise<{ name: string; bech32Address: string; pubKey: Uint8Array }>
  /** Direct signer. Requested on purpose — see `getSigner`. */
  getOfflineSigner(chainId: string): OfflineSigner
  getOfflineSignerOnlyAmino(chainId: string): OfflineSigner
  getEnigmaUtils(chainId: string): unknown
  signAmino(
    chainId: string,
    signer: string,
    signDoc: AminoSignDoc,
    options?: { preferNoSetFee?: boolean; preferNoSetMemo?: boolean }
  ): Promise<AminoSignResponse>
}

declare global {
  interface Window {
    keplr?: KeplrLike
    leap?: KeplrLike
  }
}

/* -------------------------------------------------------------------------- */
/* Discovery                                                                   */
/* -------------------------------------------------------------------------- */

export type WalletId = 'keplr' | 'starshell'

export interface WalletDescriptor {
  id: WalletId
  name: string
  icon: string
  installUrl: string
}

export const WALLETS: Record<WalletId, WalletDescriptor> = {
  keplr: {
    id: 'keplr',
    name: 'Keplr',
    icon: '/img/wallet-keplr.png',
    installUrl: 'https://www.keplr.app/get'
  },
  starshell: {
    id: 'starshell',
    name: 'StarShell',
    icon: '/img/wallet-starshell.png',
    installUrl: 'https://starshell.net'
  }
}

/**
 * StarShell does not expose a `window.starshell` namespace — by design, per
 * its own API docs, injecting a detectable global is a fingerprinting risk it
 * deliberately avoids. What it actually does, confirmed against the reference
 * dashboard's own (working) detection code, is take over `window.keplr` with
 * a Keplr-compatible object, the same as Keplr itself. There is no reliable
 * way to tell the two apart from here, so — like the reference — this app
 * does not try: both wallet entries resolve to whatever sits at `window.keplr`.
 */
export function getProvider(_id: WalletId): KeplrLike | undefined {
  return window.keplr
}

export function isInstalled(id: WalletId): boolean {
  return getProvider(id) !== undefined
}

/**
 * Extensions inject on `document.readyState === 'complete'` or a little after,
 * so a check at module load reports nothing installed. Waits briefly for one to
 * appear rather than making the user reload.
 */
export function waitForProvider(id: WalletId, timeoutMs = 3000): Promise<KeplrLike | undefined> {
  const immediate = getProvider(id)
  if (immediate) return Promise.resolve(immediate)

  return new Promise((resolve) => {
    const started = Date.now()
    const tick = () => {
      const provider = getProvider(id)
      if (provider) return resolve(provider)
      if (Date.now() - started > timeoutMs) return resolve(undefined)
      setTimeout(tick, 100)
    }
    // `keplr_keystorechange` also fires on injection in some builds; polling is
    // simpler than racing several extension-specific events.
    setTimeout(tick, 50)
  })
}

/* -------------------------------------------------------------------------- */
/* Connection                                                                  */
/* -------------------------------------------------------------------------- */

export class WalletNotInstalledError extends Error {
  constructor(public readonly wallet: WalletDescriptor) {
    super(`${wallet.name} is not installed`)
    this.name = 'WalletNotInstalledError'
  }
}

export interface Connection {
  walletId: WalletId
  address: string
  /** The wallet's own label for this account, shown so a user with several knows which. */
  accountName: string
  provider: KeplrLike
  signer: OfflineSigner
  encryptionUtils: unknown
}

/**
 * The **direct** signer, not the amino-only one.
 *
 * secretjs's amino path serialises allowance `Timestamp`s as `{seconds, nanos}`
 * rather than RFC 3339, which an amino-only signer such as a Ledger rejects.
 * Fee grants are central to this app, so the direct signer is not optional.
 */
function getSigner(provider: KeplrLike): OfflineSigner {
  return provider.getOfflineSigner(CHAIN_ID)
}

export async function connect(id: WalletId): Promise<Connection> {
  const provider = await waitForProvider(id)
  if (!provider) throw new WalletNotInstalledError(WALLETS[id])

  await provider.enable(CHAIN_ID)
  const key = await provider.getKey(CHAIN_ID)

  return {
    walletId: id,
    address: key.bech32Address,
    accountName: key.name,
    provider,
    signer: getSigner(provider),
    encryptionUtils: provider.getEnigmaUtils(CHAIN_ID)
  }
}

/**
 * Fires when the user switches account or network in their wallet. Everything
 * keyed by address — balances, permits, fee grants — is wrong from that moment,
 * so this is not optional to handle.
 */
export function onAccountChange(handler: () => void): () => void {
  window.addEventListener('keplr_keystorechange', handler)
  return () => window.removeEventListener('keplr_keystorechange', handler)
}

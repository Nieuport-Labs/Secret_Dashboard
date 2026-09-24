import { CHAIN_ID } from '@/chains/secret4'
import {
  DEVICE_KEY_LIFETIME_MS,
  parseSettingsBody,
  type DeviceKeyBody,
  type SettingsBody,
  type SignedSettingsRecord,
  type SyncedSettings,
  type WalletSigned
} from '@/lib/settingsRecord'
import { getProvider, type WalletId } from '@/lib/wallet'

/**
 * The client half of `api/settings.ts`: the device key, and reading and
 * writing the signed settings.
 *
 * The device key is what keeps a toggle from being a wallet prompt. It is a
 * P-256 key made with WebCrypto in this browser; the wallet signs one message
 * saying "this key may write my settings", once per device and account every
 * 180 days, and from then on this browser signs changes itself.
 *
 * What that trades: whoever can read this origin's storage can also rewrite
 * this account's settings until the key expires. It cannot move funds, sign a
 * transaction or touch the profile — the key is good for this store and
 * nothing else, which the server checks by `kind`.
 */

const ENDPOINT = '/api/settings'
/** Renew a little before the server would refuse, so a save never lands on an expired key. */
const RENEW_BEFORE_MS = 24 * 60 * 60_000

interface DeviceKey {
  /** The private key, as WebCrypto exported it. */
  jwk: JsonWebKey
  expiresAt: number
  delegation: WalletSigned
}

const storageKey = (address: string) => `secret-dashboard:device-key:${address}`

function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  let binary = ''
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function readDeviceKey(address: string): DeviceKey | undefined {
  try {
    const raw = localStorage.getItem(storageKey(address))
    if (!raw) return undefined
    const key = JSON.parse(raw) as DeviceKey
    return key.expiresAt - RENEW_BEFORE_MS > Date.now() ? key : undefined
  } catch {
    return undefined
  }
}

/** Whether this browser may write the account's settings without asking the wallet. */
export function hasDeviceKey(address: string): boolean {
  return readDeviceKey(address) !== undefined
}

export function forgetDeviceKey(address: string): void {
  try {
    localStorage.removeItem(storageKey(address))
  } catch {
    // Nothing stored, then.
  }
}

/** Whether the wallet can sign the message that vouches for a device key. */
export function canAuthorizeDevice(walletId: WalletId): boolean {
  return Boolean(getProvider(walletId)?.signArbitrary)
}

/** One wallet prompt, no fee: the wallet signs a message, not a transaction. */
export async function authorizeDevice(walletId: WalletId, address: string): Promise<void> {
  const wallet = getProvider(walletId)
  if (!wallet?.signArbitrary) throw new Error('This wallet cannot sign messages, so settings cannot sync.')

  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify'
  ])
  const publicKey = toBase64(await crypto.subtle.exportKey('raw', pair.publicKey))
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey)

  const issuedAt = Date.now()
  const body: DeviceKeyBody = {
    v: 1,
    kind: 'device-key',
    address,
    key: publicKey,
    issuedAt,
    expiresAt: issuedAt + DEVICE_KEY_LIFETIME_MS
  }
  const data = JSON.stringify(body)
  const signed = await wallet.signArbitrary(CHAIN_ID, address, data)

  const key: DeviceKey = {
    jwk,
    expiresAt: body.expiresAt,
    delegation: { data, signature: signed.signature, pubKey: signed.pub_key.value }
  }
  localStorage.setItem(storageKey(address), JSON.stringify(key))
}

export async function fetchSettings(address: string): Promise<SettingsBody | undefined> {
  const response = await fetch(`${ENDPOINT}?address=${encodeURIComponent(address)}`)
  if (!response.ok) throw new Error(`settings server answered ${response.status}`)
  const reply = (await response.json()) as { record?: SignedSettingsRecord | null }
  if (!reply.record || typeof reply.record.data !== 'string') return undefined
  const body = parseSettingsBody(reply.record.data)
  // A store that answers with another account's settings is answering nothing.
  return typeof body === 'string' || body.address !== address ? undefined : body
}

export class SettingsSyncError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

/**
 * Sign with this device's key and store. Resolves once the server holds these
 * or something newer (409 — the same outcome for this device). Throws when
 * there is no device key; call `authorizeDevice` first.
 */
export async function pushSettings(
  address: string,
  settings: SyncedSettings,
  signedAt: number
): Promise<void> {
  const key = readDeviceKey(address)
  if (!key) throw new SettingsSyncError('This device is not authorised to sync settings.', 0)

  const privateKey = await crypto.subtle.importKey(
    'jwk',
    key.jwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  )
  const body: SettingsBody = { v: 1, kind: 'settings', address, signedAt, settings }
  const data = JSON.stringify(body)
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    new TextEncoder().encode(data)
  )
  const record: SignedSettingsRecord = { data, signature: toBase64(signature), delegation: key.delegation }

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(record)
  })
  if (response.ok || response.status === 409) return

  const reply = (await response.json().catch(() => ({}))) as { error?: string }
  // A key the server will not take is no use to keep; the next save asks again.
  if (response.status === 401) forgetDeviceKey(address)
  throw new SettingsSyncError(reply.error ?? `settings server answered ${response.status}`, response.status)
}

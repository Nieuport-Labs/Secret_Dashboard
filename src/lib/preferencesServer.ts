import { CHAIN_ID } from '@/chains/secret4'
import {
  parsePreferencesBody,
  type Preferences,
  type PreferencesRecordBody,
  type SignedPreferencesRecord
} from '@/lib/preferencesRecord'
import { getProvider, type WalletId } from '@/lib/wallet'

/**
 * The client half of `api/preferences.ts`: sign the first-run answers for free,
 * keep them on the server, read them back.
 *
 * As with a profile, a read does not take the server's word for whose record it
 * is — the record must be about the address that was asked for.
 */

const ENDPOINT = '/api/preferences'

export interface StoredPreferences {
  body: PreferencesRecordBody
  record: SignedPreferencesRecord
}

export async function fetchPreferences(address: string): Promise<StoredPreferences | undefined> {
  const response = await fetch(`${ENDPOINT}?address=${encodeURIComponent(address)}`)
  if (!response.ok) throw new Error(`preferences server answered ${response.status}`)
  const reply = (await response.json()) as { record?: SignedPreferencesRecord | null }
  const record = reply.record
  if (!record || typeof record.data !== 'string') return undefined
  const body = parsePreferencesBody(record.data)
  if (typeof body === 'string' || body.address !== address) return undefined
  return { body, record }
}

/** Whether the connected wallet can sign a message that is not a transaction. */
export function canSignPreferences(walletId: WalletId): boolean {
  return Boolean(getProvider(walletId)?.signArbitrary)
}

/** One wallet prompt, no fee: the wallet signs a message, not a transaction. */
export async function signPreferences(
  walletId: WalletId,
  address: string,
  preferences: Preferences
): Promise<StoredPreferences> {
  const wallet = getProvider(walletId)
  if (!wallet?.signArbitrary) throw new Error('This wallet cannot sign messages.')

  const body: PreferencesRecordBody = {
    v: 1,
    kind: 'preferences',
    address,
    signedAt: Date.now(),
    preferences
  }
  const data = JSON.stringify(body)
  const signed = await wallet.signArbitrary(CHAIN_ID, address, data)
  return { body, record: { data, signature: signed.signature, pubKey: signed.pub_key.value } }
}

/**
 * Store an already signed record. Returns `true` once the server holds it or
 * something newer (409), which are the same outcome for this device.
 */
export async function sendPreferences(record: SignedPreferencesRecord): Promise<true> {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(record)
  })
  if (response.ok || response.status === 409) return true

  const reply = (await response.json().catch(() => ({}))) as { error?: string }
  throw new Error(reply.error ?? `preferences server answered ${response.status}`)
}

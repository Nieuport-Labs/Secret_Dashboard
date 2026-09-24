import { pubkeyToAddress, serializeSignDoc, type StdSignDoc } from '@cosmjs/amino'
import { Secp256k1, Secp256k1Signature, sha256 } from '@cosmjs/crypto'
import { fromBase64, toBase64, toUtf8 } from '@cosmjs/encoding'

/**
 * What `api/profile.ts` and `api/preferences.ts` have in common: a record
 * signed by the account it describes (ADR-036), kept verbatim in Upstash Redis.
 *
 * The leading underscore keeps Vercel from deploying this file as a function
 * of its own.
 *
 * Storage is Upstash Redis over its REST API — plain `fetch`, no client
 * library, so there is nothing to bundle. Vercel's Upstash integration sets
 * `KV_REST_API_URL`/`KV_REST_API_TOKEN`; a hand-made database sets the
 * `UPSTASH_REDIS_REST_*` pair. Either works.
 */

/** Copied from `src/chains/secret4.ts` — the `@/` alias does not resolve here. */
const LCD_URLS = ['https://lcd-secret.keplr.app', 'https://rest.lavenderfive.com:443/secretnetwork']

/** How far ahead of this server's clock a signature may claim to be. */
export const MAX_CLOCK_SKEW_MS = 5 * 60_000

export const ADDRESS = /^secret1[02-9ac-hj-np-z]{38}$/

/**
 * What travels and what is stored. `data` is the exact string the wallet
 * signed; it is kept verbatim rather than re-serialised, because the signature
 * covers bytes, not meaning, and anyone should be able to check it again.
 */
export interface SignedRecord {
  data: string
  /** Base64 secp256k1 signature, 64 bytes. */
  signature: string
  /** Base64 compressed secp256k1 public key. */
  pubKey: string
}

export function json(body: unknown, status = 200, cache = 'no-store'): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': cache }
  })
}

/* -------------------------------------------------------------------------- */
/* Redis                                                                       */
/* -------------------------------------------------------------------------- */

export async function redis<T>(command: Array<string>): Promise<T> {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) throw new Error('storage is not configured')

  const response = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(command)
  })
  const reply = (await response.json()) as { result?: T; error?: string }
  if (!response.ok || reply.error) throw new Error(reply.error ?? `storage answered ${response.status}`)
  return reply.result as T
}

export function decodeStored(raw: string | null): SignedRecord | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as SignedRecord
  } catch {
    return null
  }
}

/** Only the three fields, whatever else the request carried. */
export function cleanRecord(record: SignedRecord): SignedRecord {
  return { data: record.data, signature: record.signature, pubKey: record.pubKey }
}

/** Parses a request body into a record, or says why it is not one. */
export function parseSigned(text: string): SignedRecord | string {
  let record: SignedRecord
  try {
    record = JSON.parse(text) as SignedRecord
  } catch {
    return 'not JSON'
  }
  if (
    typeof record?.data !== 'string' ||
    typeof record.signature !== 'string' ||
    typeof record.pubKey !== 'string'
  ) {
    return 'data, signature and pubKey are required'
  }
  return record
}

/* -------------------------------------------------------------------------- */
/* Verification                                                                */
/* -------------------------------------------------------------------------- */

/** The document Keplr's `signArbitrary` signs (ADR-036), rebuilt byte for byte. */
function adr36SignDoc(signer: string, data: string): StdSignDoc {
  return {
    chain_id: '',
    account_number: '0',
    sequence: '0',
    fee: { gas: '0', amount: [] },
    msgs: [{ type: 'sign/MsgSignData', value: { signer, data: toBase64(toUtf8(data)) } }],
    memo: ''
  }
}

/** Whether `address` signed `record.data`. Returns the reason it did not. */
export async function verify(record: SignedRecord, address: string): Promise<string | undefined> {
  let pubKey: Uint8Array
  let signature: Uint8Array
  try {
    pubKey = fromBase64(record.pubKey)
    signature = fromBase64(record.signature)
  } catch {
    return 'signature or key is not base64'
  }

  // The key must be the account's, or anyone could sign for anyone.
  const derived = pubkeyToAddress({ type: 'tendermint/PubKeySecp256k1', value: record.pubKey }, 'secret')
  if (derived !== address) return 'key does not belong to this address'

  const digest = sha256(serializeSignDoc(adr36SignDoc(address, record.data)))
  try {
    const valid = await Secp256k1.verifySignature(
      Secp256k1Signature.fromFixedLength(signature),
      digest,
      pubKey
    )
    return valid ? undefined : 'signature does not verify'
  } catch {
    return 'signature is malformed'
  }
}

/**
 * Only accounts the chain has seen. Generating keys is free, and without this
 * anyone could fill the store with a million signed records for addresses that
 * have never held a token. An account exists once something was sent to it,
 * which costs someone a fee.
 */
export async function accountExists(address: string): Promise<boolean> {
  for (const base of LCD_URLS) {
    try {
      const response = await fetch(`${base}/cosmos/auth/v1beta1/accounts/${address}`)
      if (response.status === 404) return false
      if (response.ok) return true
    } catch {
      // Try the next node.
    }
  }
  throw new Error('could not reach the chain to check the account')
}

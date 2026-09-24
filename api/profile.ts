import { pubkeyToAddress, serializeSignDoc, type StdSignDoc } from '@cosmjs/amino'
import { Secp256k1, Secp256k1Signature, sha256 } from '@cosmjs/crypto'
import { fromBase64, toBase64, toUtf8 } from '@cosmjs/encoding'

import {
  parseRecordBody,
  type ProfileRecordBody,
  type SignedProfileRecord
} from '../src/lib/profileRecord.js'

/**
 * Off-chain profiles, for accounts that cannot pay to write one on chain yet.
 *
 *   GET  /api/profile?address=secret1…           → { record: SignedProfileRecord | null }
 *   POST /api/profile  body: SignedProfileRecord → { ok: true } | { error }
 *
 * Nothing here is trusted because this server said so. Every record is an
 * ADR-036 signature by the account it describes, stored verbatim, so a reader
 * can check it without asking us. What the server adds is only a place to keep
 * it until the owner's next transaction writes it on chain (`src/lib/sendTx.ts`).
 *
 * What this costs in privacy, and the UI says so: the registry contract cannot
 * be enumerated, this store can. Whoever runs it has the list of addresses that
 * saved a profile here.
 *
 * Storage is Upstash Redis over its REST API — plain `fetch`, no client
 * library, so there is nothing to bundle. Vercel's Upstash integration sets
 * `KV_REST_API_URL`/`KV_REST_API_TOKEN`; a hand-made database sets the
 * `UPSTASH_REDIS_REST_*` pair. Either works.
 */

/** Copied from `src/chains/secret4.ts` — the `@/` alias does not resolve here. */
const LCD_URLS = ['https://lcd-secret.keplr.app', 'https://rest.lavenderfive.com:443/secretnetwork']

/** A full avatar is 12 kB of base64 inside a JSON string inside JSON. */
const MAX_BODY_BYTES = 40_000
/** How far ahead of this server's clock a signature may claim to be. */
const MAX_CLOCK_SKEW_MS = 5 * 60_000

const ADDRESS = /^secret1[02-9ac-hj-np-z]{38}$/

function json(body: unknown, status = 200, cache = 'no-store'): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': cache }
  })
}

/* -------------------------------------------------------------------------- */
/* Redis                                                                       */
/* -------------------------------------------------------------------------- */

async function redis<T>(command: Array<string>): Promise<T> {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) throw new Error('profile storage is not configured')

  const response = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(command)
  })
  const reply = (await response.json()) as { result?: T; error?: string }
  if (!response.ok || reply.error) throw new Error(reply.error ?? `storage answered ${response.status}`)
  return reply.result as T
}

const keyFor = (address: string) => `profile:v1:${address}`

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

async function verify(record: SignedProfileRecord, body: ProfileRecordBody): Promise<string | undefined> {
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
  if (derived !== body.address) return 'key does not belong to this address'

  const digest = sha256(serializeSignDoc(adr36SignDoc(body.address, record.data)))
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
 * anyone could fill the store with a million signed profiles for addresses that
 * have never held a token. An account exists once something was sent to it,
 * which costs someone a fee.
 */
async function accountExists(address: string): Promise<boolean> {
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

/* -------------------------------------------------------------------------- */
/* Handlers                                                                    */
/* -------------------------------------------------------------------------- */

function decodeStored(raw: string | null): SignedProfileRecord | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as SignedProfileRecord
  } catch {
    return null
  }
}

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams

  const address = params.get('address') ?? ''
  if (!ADDRESS.test(address)) return json({ error: 'bad address' }, 400)

  try {
    const raw = await redis<string | null>(['GET', keyFor(address)])
    return json({ record: decodeStored(raw) }, 200, 'public, s-maxage=15, stale-while-revalidate=60')
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'storage failed' }, 503)
  }
}

export async function POST(request: Request): Promise<Response> {
  const text = await request.text()
  if (text.length > MAX_BODY_BYTES) return json({ error: 'record is too large' }, 413)

  let record: SignedProfileRecord
  try {
    record = JSON.parse(text) as SignedProfileRecord
  } catch {
    return json({ error: 'not JSON' }, 400)
  }
  if (
    typeof record?.data !== 'string' ||
    typeof record.signature !== 'string' ||
    typeof record.pubKey !== 'string'
  ) {
    return json({ error: 'data, signature and pubKey are required' }, 400)
  }

  const body = parseRecordBody(record.data)
  if (typeof body === 'string') return json({ error: body }, 400)
  if (!ADDRESS.test(body.address)) return json({ error: 'bad address' }, 400)
  if (body.signedAt > Date.now() + MAX_CLOCK_SKEW_MS) return json({ error: 'signed in the future' }, 400)

  const problem = await verify(record, body)
  if (problem) return json({ error: problem }, 401)

  try {
    if (!(await accountExists(body.address))) {
      return json({ error: 'this account has never appeared on chain' }, 403)
    }

    // Newer wins. An older signature replayed — or an older tab saving late —
    // must not overwrite what the owner signed since.
    const stored = decodeStored(await redis<string | null>(['GET', keyFor(body.address)]))
    if (stored) {
      const previous = parseRecordBody(stored.data)
      if (typeof previous !== 'string' && previous.signedAt >= body.signedAt) {
        return json({ error: 'a newer profile is already saved' }, 409)
      }
    }

    const clean: SignedProfileRecord = {
      data: record.data,
      signature: record.signature,
      pubKey: record.pubKey
    }
    await redis(['SET', keyFor(body.address), JSON.stringify(clean)])
    return json({ ok: true })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'storage failed' }, 503)
  }
}

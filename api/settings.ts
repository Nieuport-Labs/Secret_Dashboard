import {
  accountExists,
  ADDRESS,
  decodeStored,
  json,
  MAX_CLOCK_SKEW_MS,
  redis,
  verify,
  verifyP256,
  type SignedRecord
} from './_signed.js'
import {
  parseDeviceKeyBody,
  parseSettingsBody,
  type SignedSettingsRecord
} from '../src/lib/settingsRecord.js'

/**
 * Settings that follow an account between devices (`src/lib/settingsRecord.ts`).
 *
 *   GET  /api/settings?address=secret1…              → { record: SignedSettingsRecord | null }
 *   POST /api/settings  body: SignedSettingsRecord   → { ok: true } | { error }
 *
 * A record is settings signed by a device key, plus the wallet's signature
 * vouching for that key. Both are checked on every write, so the server keeps
 * no list of keys and there is nothing to register: a device is authorised
 * exactly as long as the wallet's statement says it is.
 *
 * The rest are the profile store's rules: newer wins, and only accounts the
 * chain has seen.
 */

/** Nine small fields and two signatures. */
const MAX_BODY_BYTES = 4_000

const keyFor = (address: string) => `settings:v1:${address}`

function parseRecord(text: string): SignedSettingsRecord | string {
  let record: SignedSettingsRecord
  try {
    record = JSON.parse(text) as SignedSettingsRecord
  } catch {
    return 'not JSON'
  }
  const delegation = record?.delegation
  if (
    typeof record?.data !== 'string' ||
    typeof record.signature !== 'string' ||
    typeof delegation?.data !== 'string' ||
    typeof delegation.signature !== 'string' ||
    typeof delegation.pubKey !== 'string'
  ) {
    return 'data, signature and delegation are required'
  }
  return {
    data: record.data,
    signature: record.signature,
    delegation: { data: delegation.data, signature: delegation.signature, pubKey: delegation.pubKey }
  }
}

function decodeRecord(raw: string | null): SignedSettingsRecord | null {
  // `decodeStored` is typed for the plain shape; this one carries a delegation.
  return decodeStored(raw) as unknown as SignedSettingsRecord | null
}

export async function GET(request: Request): Promise<Response> {
  const address = new URL(request.url).searchParams.get('address') ?? ''
  if (!ADDRESS.test(address)) return json({ error: 'bad address' }, 400)

  try {
    // Not cached at the edge: a toggle flipped on one device has to be there
    // when another one loads.
    return json({ record: decodeRecord(await redis<string | null>(['GET', keyFor(address)])) })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'storage failed' }, 503)
  }
}

export async function POST(request: Request): Promise<Response> {
  const text = await request.text()
  if (text.length > MAX_BODY_BYTES) return json({ error: 'record is too large' }, 413)

  const record = parseRecord(text)
  if (typeof record === 'string') return json({ error: record }, 400)

  const body = parseSettingsBody(record.data)
  if (typeof body === 'string') return json({ error: body }, 400)
  if (!ADDRESS.test(body.address)) return json({ error: 'bad address' }, 400)

  const now = Date.now()
  if (body.signedAt > now + MAX_CLOCK_SKEW_MS) return json({ error: 'signed in the future' }, 400)

  // The wallet vouched for this key, for this account, and not too long ago.
  const device = parseDeviceKeyBody(record.delegation.data)
  if (typeof device === 'string') return json({ error: device }, 400)
  if (device.address !== body.address) return json({ error: 'device key is for another account' }, 401)
  if (device.issuedAt > now + MAX_CLOCK_SKEW_MS)
    return json({ error: 'device key issued in the future' }, 400)
  if (device.expiresAt < now) return json({ error: 'device key has expired' }, 401)

  const walletProblem = await verify(record.delegation satisfies SignedRecord, body.address)
  if (walletProblem) return json({ error: `device key: ${walletProblem}` }, 401)
  if (!(await verifyP256(device.key, record.data, record.signature))) {
    return json({ error: 'signature does not verify' }, 401)
  }

  try {
    if (!(await accountExists(body.address))) {
      return json({ error: 'this account has never appeared on chain' }, 403)
    }

    // Newer wins, so a device that was offline cannot undo a later change.
    const stored = decodeRecord(await redis<string | null>(['GET', keyFor(body.address)]))
    if (stored) {
      const previous = parseSettingsBody(stored.data)
      if (typeof previous !== 'string' && previous.signedAt >= body.signedAt) {
        return json({ error: 'newer settings are already saved' }, 409)
      }
    }

    await redis(['SET', keyFor(body.address), JSON.stringify(record)])
    return json({ ok: true })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'storage failed' }, 503)
  }
}

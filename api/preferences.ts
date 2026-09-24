import {
  accountExists,
  ADDRESS,
  cleanRecord,
  decodeStored,
  json,
  MAX_CLOCK_SKEW_MS,
  parseSigned,
  redis,
  verify
} from './_signed.js'
import { parsePreferencesBody } from '../src/lib/preferencesRecord.js'

/**
 * The answers to the first-run questions (`src/lib/preferencesRecord.ts`).
 *
 *   GET  /api/preferences?address=secret1…               → { record: SignedPreferencesRecord | null }
 *   POST /api/preferences  body: SignedPreferencesRecord → { ok: true } | { error }
 *
 * Kept here rather than only in the browser so they follow the account to
 * another device, and so the questions are asked once per account rather than
 * once per browser. The rules are the profile store's: signed by the account,
 * newer wins, only accounts the chain has seen.
 */

/** Two short enums and a signature. Anything near this is not a preferences record. */
const MAX_BODY_BYTES = 2_000

const keyFor = (address: string) => `preferences:v1:${address}`

export async function GET(request: Request): Promise<Response> {
  const address = new URL(request.url).searchParams.get('address') ?? ''
  if (!ADDRESS.test(address)) return json({ error: 'bad address' }, 400)

  try {
    const raw = await redis<string | null>(['GET', keyFor(address)])
    // Not cached at the edge: an answer given a second ago on this device has
    // to be there when the page reloads, or the questions come back.
    return json({ record: decodeStored(raw) })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'storage failed' }, 503)
  }
}

export async function POST(request: Request): Promise<Response> {
  const text = await request.text()
  if (text.length > MAX_BODY_BYTES) return json({ error: 'record is too large' }, 413)

  const record = parseSigned(text)
  if (typeof record === 'string') return json({ error: record }, 400)

  const body = parsePreferencesBody(record.data)
  if (typeof body === 'string') return json({ error: body }, 400)
  if (!ADDRESS.test(body.address)) return json({ error: 'bad address' }, 400)
  if (body.signedAt > Date.now() + MAX_CLOCK_SKEW_MS) return json({ error: 'signed in the future' }, 400)

  const problem = await verify(record, body.address)
  if (problem) return json({ error: problem }, 401)

  try {
    if (!(await accountExists(body.address))) {
      return json({ error: 'this account has never appeared on chain' }, 403)
    }

    // Newer wins, so a copy replayed from an older device cannot undo a change.
    const stored = decodeStored(await redis<string | null>(['GET', keyFor(body.address)]))
    if (stored) {
      const previous = parsePreferencesBody(stored.data)
      if (typeof previous !== 'string' && previous.signedAt >= body.signedAt) {
        return json({ error: 'newer preferences are already saved' }, 409)
      }
    }

    await redis(['SET', keyFor(body.address), JSON.stringify(cleanRecord(record))])
    return json({ ok: true })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'storage failed' }, 503)
  }
}

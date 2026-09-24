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
import { parseRecordBody } from '../src/lib/profileRecord.js'

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
 * Storage, signature checks and the "has the chain seen it" gate are shared
 * with `api/settings.ts`, in `api/_signed.ts`.
 */

/** A full avatar is 12 kB of base64 inside a JSON string inside JSON. */
const MAX_BODY_BYTES = 40_000

const keyFor = (address: string) => `profile:v1:${address}`

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

  const record = parseSigned(text)
  if (typeof record === 'string') return json({ error: record }, 400)

  const body = parseRecordBody(record.data)
  if (typeof body === 'string') return json({ error: body }, 400)
  if (!ADDRESS.test(body.address)) return json({ error: 'bad address' }, 400)
  if (body.signedAt > Date.now() + MAX_CLOCK_SKEW_MS) return json({ error: 'signed in the future' }, 400)

  const problem = await verify(record, body.address)
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

    await redis(['SET', keyFor(body.address), JSON.stringify(cleanRecord(record))])
    return json({ ok: true })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'storage failed' }, 503)
  }
}

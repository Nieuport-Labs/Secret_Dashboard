/**
 * The Secret community fee grant faucet, on behalf of the browser.
 *
 *   POST /api/faucet  body: { address: "secret1…" }
 *                     → { granter, spendLimit, expiration } | { error }
 *
 * The faucet (SecretSaturn's FeeGrantFaucet, `GET /claim/:address`) grants an
 * address a small fee allowance for a day — enough for someone holding no SCRT
 * to send their first transaction. It sends no CORS headers, so a page cannot
 * call it itself; this does, and passes on only what the page needs.
 *
 * The app asks for one only to buy gas credits with a private token when
 * nothing else can pay the fee, and only when the button is pressed.
 */

const FAUCET_URL = (process.env.FEE_FAUCET_URL ?? 'https://faucet.secretsaturn.net').replace(/\/$/, '')
const ADDRESS = /^secret1[02-9ac-hj-np-z]{38}$/
/** The faucet broadcasts the grant and waits for the block. */
const TIMEOUT_MS = 25_000

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
  })
}

interface FaucetReply {
  feegrant?: {
    granter?: string
    allowance?: { spend_limit?: Array<{ amount?: string; denom?: string }>; expiration?: string }
  }
  error?: unknown
}

export async function POST(request: Request): Promise<Response> {
  let body: { address?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return json({ error: 'not JSON' }, 400)
  }
  if (typeof body.address !== 'string' || !ADDRESS.test(body.address)) {
    return json({ error: 'bad address' }, 400)
  }

  let reply: FaucetReply
  try {
    const response = await fetch(`${FAUCET_URL}/claim/${body.address}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    reply = (await response.json().catch(() => ({}))) as FaucetReply
    if (!response.ok) {
      console.error('faucet refused:', response.status, JSON.stringify(reply.error ?? reply).slice(0, 300))
      return json({ error: 'The faucet did not grant anything.' }, 502)
    }
  } catch (error) {
    console.error('faucet unreachable:', error instanceof Error ? error.message : error)
    return json({ error: 'The faucet could not be reached.' }, 503)
  }

  const grant = reply.feegrant
  const limit = grant?.allowance?.spend_limit?.find((coin) => coin.denom === 'uscrt')?.amount
  if (!grant?.granter || !ADDRESS.test(grant.granter) || !limit || !/^\d+$/.test(limit)) {
    return json({ error: 'The faucet answered with no grant.' }, 502)
  }
  return json({ granter: grant.granter, spendLimit: limit, expiration: grant.allowance?.expiration })
}

import { json, redis } from './_signed.js'

/**
 * A starter fee grant, on behalf of the browser.
 *
 *   POST /api/faucet  body: { address: "secret1…" }
 *                     → { granter, spendLimit, expiration } | { error }
 *
 * For someone holding no SCRT and no gas credits: enough to pay the fee of the
 * one transaction that buys their first credits with a private token. The app
 * asks for it only then, and only when the button is pressed.
 *
 * Two ways to grant, in this order:
 *
 * 1. **Its own wallet**, when `FEE_GRANTER_MNEMONIC` is set: a grant of
 *    `FEE_GRANT_USCRT` (0.1 SCRT), for contract executions only, lasting an
 *    hour. Rate limited in Redis — once a day per address, a few per IP, and
 *    `FEE_GRANTS_PER_DAY` in all — so the most anyone can cost the wallet is
 *    that many grants a day, and only as fees actually spent.
 * 2. **The community faucet** at `FEE_FAUCET_URL` (SecretSaturn's
 *    FeeGrantFaucet, `GET /claim/:address`), which sends no CORS headers, so
 *    the page cannot call it itself. The public instance at
 *    faucet.secretsaturn.net no longer resolves, so this is only worth setting
 *    for an instance that is up.
 */

const ADDRESS = /^secret1[02-9ac-hj-np-z]{38}$/
const CHAIN_ID = 'secret-4'
const LCD_URLS = ['https://lcd-secret.keplr.app', 'https://rest.lavenderfive.com:443/secretnetwork']

const GRANT_USCRT = BigInt(process.env.FEE_GRANT_USCRT ?? '100000')
const GRANTS_PER_DAY = Number(process.env.FEE_GRANTS_PER_DAY ?? '20')
const GRANTS_PER_IP = 3
/** Long enough to sign the purchase; short enough that an unused one lapses. */
const GRANT_TTL_S = 60 * 60
const DAY_S = 24 * 60 * 60
const MSG_EXECUTE_CONTRACT = '/secret.compute.v1beta1.MsgExecuteContract'

/** The faucet broadcasts the grant and waits for the block. */
const TIMEOUT_MS = 25_000

interface Grant {
  granter: string
  spendLimit: string
  expiration?: string
}

class Refused extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
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

  const mnemonic = process.env.FEE_GRANTER_MNEMONIC
  const faucetUrl = process.env.FEE_FAUCET_URL
  try {
    if (mnemonic) return json(await grantOwn(mnemonic, body.address, clientIp(request)))
    if (faucetUrl) return json(await claimFromFaucet(faucetUrl, body.address))
    return json({ error: 'No fee grant faucet is set up for this dashboard.' }, 503)
  } catch (error) {
    if (error instanceof Refused) return json({ error: error.message }, error.status)
    console.error('faucet failed:', error instanceof Error ? error.message : error)
    return json({ error: 'The faucet could not grant a fee right now.' }, 503)
  }
}

function clientIp(request: Request): string {
  return (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown'
}

/* -------------------------------------------------------------------------- */
/* Our own wallet                                                              */
/* -------------------------------------------------------------------------- */

async function grantOwn(mnemonic: string, grantee: string, ip: string): Promise<Grant> {
  const { MsgGrantAllowance, MsgRevokeAllowance, SecretNetworkClient, Wallet } = await import('secretjs')
  const wallet = new Wallet(mnemonic)
  const granter = wallet.address
  if (granter === grantee) throw new Refused('bad address', 400)

  const lcd = await firstLcd()
  const client = new SecretNetworkClient({ chainId: CHAIN_ID, url: lcd, wallet, walletAddress: granter })

  // A grant from here still good for a purchase is simply handed back.
  const standing = await client.query.feegrant
    .allowance({ granter, grantee })
    .then((reply) => reply.allowance)
    .catch(() => undefined)
  const left = standing ? standingLeft(standing.allowance) : undefined
  if (left && left.amount >= GRANT_USCRT / 2n && left.expires > Date.now() + 5 * 60_000) {
    return { granter, spendLimit: left.amount.toString(), expiration: new Date(left.expires).toISOString() }
  }

  // Limits, counted before anything is spent. Without storage there are none,
  // so nothing is granted.
  const day = new Date().toISOString().slice(0, 10)
  const first = await redis<string | null>([
    'SET',
    `faucet:address:${grantee}`,
    '1',
    'NX',
    'EX',
    String(DAY_S)
  ])
  if (first !== 'OK') throw new Refused('This address already had a starter grant today.', 429)
  const perIp = await redis<number>(['INCR', `faucet:ip:${day}:${ip}`])
  if (perIp === 1) await redis(['EXPIRE', `faucet:ip:${day}:${ip}`, String(DAY_S)])
  const total = await redis<number>(['INCR', `faucet:total:${day}`])
  if (total === 1) await redis(['EXPIRE', `faucet:total:${day}`, String(DAY_S)])
  if (perIp > GRANTS_PER_IP || total > GRANTS_PER_DAY) {
    throw new Refused('The faucet has given out all it can for today. Try again tomorrow.', 429)
  }

  const expires = Math.floor(Date.now() / 1000) + GRANT_TTL_S
  const messages = [
    // One grant per granter and grantee: a spent or lapsed one is replaced.
    ...(standing ? [new MsgRevokeAllowance({ granter, grantee })] : []),
    new MsgGrantAllowance({
      granter,
      grantee,
      allowance: {
        allowance: {
          spend_limit: [{ denom: 'uscrt', amount: GRANT_USCRT.toString() }],
          expiration: { seconds: String(expires), nanos: 0 }
        },
        allowed_messages: [MSG_EXECUTE_CONTRACT]
      }
    })
  ]
  const tx = await client.tx.broadcast(messages, {
    gasLimit: standing ? 80_000 : 50_000,
    gasPriceInFeeDenom: 0.1,
    feeDenom: 'uscrt',
    waitForCommit: true,
    broadcastTimeoutMs: TIMEOUT_MS
  })
  if (tx.code !== 0) {
    // Not the visitor's fault: let them try again.
    await redis(['DEL', `faucet:address:${grantee}`]).catch(() => undefined)
    throw new Error(`grant rejected: ${tx.rawLog.slice(0, 300)}`)
  }
  console.log('faucet granted', grantee, tx.transactionHash)
  return {
    granter,
    spendLimit: GRANT_USCRT.toString(),
    expiration: new Date(expires * 1000).toISOString()
  }
}

async function firstLcd(): Promise<string> {
  for (const base of LCD_URLS) {
    try {
      const response = await fetch(`${base}/cosmos/base/tendermint/v1beta1/node_info`, {
        signal: AbortSignal.timeout(4000)
      })
      if (response.ok) return base
    } catch {
      // Try the next node.
    }
  }
  throw new Error('could not reach the chain')
}

/** What a grant from here still covers and when it lapses, if it is one of ours. */
function standingLeft(allowance: unknown): { amount: bigint; expires: number } | undefined {
  const outer = allowance as {
    allowance?: { spend_limit?: Array<{ denom?: string; amount?: string }>; expiration?: string }
  }
  const basic = outer?.allowance
  const amount = basic?.spend_limit?.find((coin) => coin.denom === 'uscrt')?.amount
  if (!amount || !basic?.expiration) return undefined
  return { amount: BigInt(amount), expires: Date.parse(basic.expiration) }
}

/* -------------------------------------------------------------------------- */
/* A FeeGrantFaucet instance                                                   */
/* -------------------------------------------------------------------------- */

interface FaucetReply {
  feegrant?: {
    granter?: string
    allowance?: { spend_limit?: Array<{ amount?: string; denom?: string }>; expiration?: string }
  }
  error?: unknown
}

async function claimFromFaucet(base: string, address: string): Promise<Grant> {
  let reply: FaucetReply
  try {
    const response = await fetch(`${base.replace(/\/$/, '')}/claim/${address}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    reply = (await response.json().catch(() => ({}))) as FaucetReply
    if (!response.ok) {
      console.error('faucet refused:', response.status, JSON.stringify(reply.error ?? reply).slice(0, 300))
      throw new Refused('The faucet did not grant anything.', 502)
    }
  } catch (error) {
    if (error instanceof Refused) throw error
    const cause = error instanceof Error && error.cause instanceof Error ? ` (${error.cause.message})` : ''
    console.error('faucet unreachable:', error instanceof Error ? error.message : error, cause)
    throw new Refused('The faucet could not be reached.', 503)
  }

  const grant = reply.feegrant
  const limit = grant?.allowance?.spend_limit?.find((coin) => coin.denom === 'uscrt')?.amount
  if (!grant?.granter || !ADDRESS.test(grant.granter) || !limit || !/^\d+$/.test(limit)) {
    throw new Refused('The faucet answered with no grant.', 502)
  }
  return { granter: grant.granter, spendLimit: limit, expiration: grant.allowance?.expiration }
}

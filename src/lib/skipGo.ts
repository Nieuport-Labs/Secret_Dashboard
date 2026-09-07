import { CHAIN_ID as SECRET_CHAIN_ID, DENOM } from '@/chains/secret4'
import { OSMOSIS_CHAIN_ID } from '@/chains/osmosis'

/**
 * Skip Go's public routing API, used only for "Get gas": swapping a slice of
 * whatever is being bridged into SCRT, over whatever liquidity actually
 * exists today.
 *
 * This replaces a hand-composed memo against Osmosis's `crosschain-swaps`
 * contract. That contract turned out to route through a tiny, hand-maintained
 * pool list — one entry per asset, added by its owner one governance action at
 * a time — that was never given an entry for anything but `OSMO → SCRT`. A
 * live packet bridging USDC failed with "No route found" for exactly that
 * reason; see docs/chain-facts.md. Skip's router draws on Osmosis's live
 * poolmanager instead of a hardcoded list, and hands back fully-formed
 * messages rather than asking the caller to compose a wasm hook the old
 * contract never documented.
 *
 * The trade a rewrite like this makes: Skip decides the swap route and the
 * exact memo, which means the `credits` delivery path — landing a fee
 * allowance from the gas vault rather than spendable SCRT — has no way to
 * attach itself to a message Skip already assembled. `native` was always the
 * default for its own, separate reason (chain-facts.md: the vault's memo
 * shape was never verified against a real packet); it is now the only path.
 */

const SKIP_API = 'https://api.skip.build'

/** How long a genuinely offline or hung Skip endpoint gets before this gives up. */
const TIMEOUT_MS = 12_000

export interface SkipGasRoute {
  /** SCRT the swap is expected to produce, in base units — Skip's own
   *  estimate from real pool state, not a price-based guess. */
  amountOutBaseUnits: string
  /** Every chain the packet passes through, source first, Secret last. */
  chainIds: string[]
  /** Handed back to `/msgs` unmodified. Route parameters are not something to
   *  reconstruct by hand between the two calls. */
  raw: Record<string, unknown>
}

export interface SkipRouteParams {
  /** The bridged token's denomination as the *source* chain knows it. */
  sourceDenom: string
  sourceChainId: string
  /** How much of it to swap, in the token's base units. */
  amountInBaseUnits: string
}

/**
 * Whether a slice of `sourceDenom` can reach Secret as SCRT at all, and
 * roughly how much it would become.
 *
 * `undefined` covers every way this can fail to answer — no network, a
 * timeout, an HTTP error, or Skip genuinely finding no path — because none of
 * them are this app's to explain in detail. What matters to the caller is
 * simply whether to offer the option.
 */
export async function fetchSkipGasRoute({
  sourceDenom,
  sourceChainId,
  amountInBaseUnits
}: SkipRouteParams): Promise<SkipGasRoute | undefined> {
  try {
    const response = await fetch(`${SKIP_API}/v2/fungible/route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        source_asset_denom: sourceDenom,
        source_asset_chain_id: sourceChainId,
        dest_asset_denom: DENOM,
        dest_asset_chain_id: SECRET_CHAIN_ID,
        amount_in: amountInBaseUnits,
        allow_multi_tx: true,
        allow_unsafe: false,
        smart_relay: true
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    if (!response.ok) return undefined

    const body = (await response.json()) as {
      does_swap?: boolean
      amount_out?: string
      estimated_amount_out?: string
      chain_ids?: string[]
      operations?: unknown[]
    }

    const amountOut = body.amount_out ?? body.estimated_amount_out
    if (!body.does_swap || !amountOut || !body.chain_ids?.length || !body.operations?.length) {
      return undefined
    }

    return { amountOutBaseUnits: amountOut, chainIds: body.chain_ids, raw: body }
  } catch {
    return undefined
  }
}

export interface SkipAddresses {
  /** Address on the chain the deposit starts from — the first entry in `chainIds`. */
  source: string
  /** The same key's address on Osmosis, when the route passes through it. */
  osmosis?: string
  secret: string
}

/**
 * Match each chain a route passes through to an address, or refuse if it
 * needs one this app has no way to supply.
 *
 * Scoped deliberately to the two shapes actually exercised: source → Osmosis
 * → Secret (the ordinary case — verified against a live packet, see
 * chain-facts.md) or Osmosis → Secret directly, when the deposit starts on
 * Osmosis itself and `source` already *is* the Osmosis address. A route
 * through any other intermediate chain is refused rather than guessed at:
 * deriving and enabling an address for a chain nobody asked the wallet about
 * is a new failure mode this feature does not need to take on.
 */
export function planSkipAddresses(chainIds: string[], addresses: SkipAddresses): string[] | undefined {
  if (chainIds.length === 3 && chainIds[1] === OSMOSIS_CHAIN_ID && chainIds[2] === SECRET_CHAIN_ID) {
    return addresses.osmosis ? [addresses.source, addresses.osmosis, addresses.secret] : undefined
  }
  if (chainIds.length === 2 && chainIds[0] === OSMOSIS_CHAIN_ID && chainIds[1] === SECRET_CHAIN_ID) {
    return [addresses.source, addresses.secret]
  }
  return undefined
}

export interface SkipTransferLeg {
  /** Denomination as the *source* chain knows it — matches `Leg.denom`. */
  denom: string
  amount: string
  /** Source chain's own channel to the first hop — Osmosis, ordinarily. */
  channel: string
  receiver: string
  memo: string
}

/**
 * The one message a gas-leg plan needs, from Skip's `/msgs` endpoint.
 *
 * Only ever asks for a single signature on the source chain — the same shape
 * `sendDeposit` already sends the main leg with — because that is the whole
 * point of routing this through IBC hooks/PFM rather than a sequence of
 * separate user-signed transfers. A plan needing more than one message is
 * refused rather than partially executed.
 */
export async function fetchSkipGasLeg(
  route: SkipGasRoute,
  addressList: string[],
  slippagePercent = 5
): Promise<SkipTransferLeg | undefined> {
  try {
    const response = await fetch(`${SKIP_API}/v2/fungible/msgs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        source_asset_denom: route.raw.source_asset_denom,
        source_asset_chain_id: route.raw.source_asset_chain_id,
        dest_asset_denom: route.raw.dest_asset_denom,
        dest_asset_chain_id: route.raw.dest_asset_chain_id,
        amount_in: route.raw.amount_in,
        amount_out: route.raw.amount_out ?? route.raw.estimated_amount_out,
        operations: route.raw.operations,
        slippage_tolerance_percent: String(slippagePercent),
        address_list: addressList
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    if (!response.ok) return undefined
    return parseSkipTransferMsg(await response.json())
  } catch {
    return undefined
  }
}

/**
 * Pull the one signable message a gas-leg plan needs out of Skip's response.
 *
 * Split from the network call so it can be tested against a captured response
 * without one — see test-bridge.ts.
 */
export function parseSkipTransferMsg(body: unknown): SkipTransferLeg | undefined {
  const msgs = (body as { msgs?: unknown[] } | undefined)?.msgs
  // More than one signature needed is not a plan this app can fold silently
  // alongside the main transfer; none at all means Skip had nothing to send.
  if (!Array.isArray(msgs) || msgs.length !== 1) return undefined

  const wrapped = (msgs[0] as { multi_chain_msg?: { msg?: unknown; msg_type_url?: unknown } }).multi_chain_msg
  if (!wrapped || wrapped.msg_type_url !== '/ibc.applications.transfer.v1.MsgTransfer') return undefined
  if (typeof wrapped.msg !== 'string') return undefined

  let parsed: {
    source_channel?: unknown
    token?: { denom?: unknown; amount?: unknown }
    receiver?: unknown
    memo?: unknown
  }
  try {
    parsed = JSON.parse(wrapped.msg) as typeof parsed
  } catch {
    return undefined
  }

  const { source_channel: channel, token, receiver, memo } = parsed
  if (
    typeof channel !== 'string' ||
    typeof token?.denom !== 'string' ||
    typeof token.amount !== 'string' ||
    typeof receiver !== 'string'
  ) {
    return undefined
  }

  return {
    channel,
    denom: token.denom,
    amount: token.amount,
    receiver,
    memo: typeof memo === 'string' ? memo : ''
  }
}

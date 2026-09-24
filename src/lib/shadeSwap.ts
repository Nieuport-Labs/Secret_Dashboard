import type { Msg, SecretNetworkClient } from 'secretjs'

import { withGasBuffer } from '@/chains/secret4'

/**
 * Just enough of ShadeSwap to turn a token into sSCRT inside another
 * transaction — what auto-refill falls back to when there is no sSCRT to spend.
 *
 * Written against Shade's own client library, shade.js (`msgSwapV2`, the
 * factory and pair queries, the contract registry in its `docs/contracts.md`),
 * rather than depending on it: shade.js brings its own copy of secretjs and
 * rxjs, which is a lot of bundle for three messages.
 *
 * Only constant-product pools are used. Their output is exact arithmetic on
 * the reserves, done here in integers; stable pools price through an oracle
 * and an iterative solver, and getting that slightly wrong is how a swap
 * fails or overpays. A token whose only route is through a stable pool is
 * simply not a candidate. Routes are one hop, or two through any token that
 * pairs with both ends.
 *
 * Nothing here trusts its own arithmetic with the user's money: every swap
 * carries a minimum return, and the router refuses to trade below it.
 */

interface ContractRef {
  address: string
  codeHash: string
}

/** Mainnet, from shade.js `docs/contracts.md`. */
export const SHADESWAP_FACTORY: ContractRef = {
  address: 'secret1ja0hcwvy76grqkpgwznxukgd7t8a8anmmx05pp',
  codeHash: '2ad4ed2a4a45fd6de3daca9541ba82c26bb66c76d1c3540de39b509abd26538e'
}

export const SHADESWAP_ROUTER: ContractRef = {
  address: 'secret1nrnh30ant2dplrlvqjgmddg4fntllwlm0pnhss',
  codeHash: 'd13768344dfa03118f2ae8f4cf7e114dbad722ba8dd93a67f1f024441a07991a'
}

/** shade.js `MsgCost`: a base plus a fixed cost per constant-product hop. */
const SWAP_GAS_BASE = 300_000
const SWAP_GAS_PER_HOP = 345_000

export interface Pair {
  contract: ContractRef
  token0: ContractRef
  token1: ContractRef
}

interface Reserves {
  amount0: bigint
  amount1: bigint
  /** Total fee as a fraction, lp + dao. */
  feeNum: bigint
  feeDen: bigint
}

export interface Hop {
  pair: Pair
  from: ContractRef
  to: ContractRef
}

export type Route = Hop[]

interface FactoryPairsReply {
  list_a_m_m_pairs?: {
    amm_pairs?: Array<{
      address: string
      code_hash: string
      enabled: boolean
      pair: [
        { custom_token?: { contract_addr: string; token_code_hash: string } },
        { custom_token?: { contract_addr: string; token_code_hash: string } },
        boolean
      ]
    }>
  }
}

interface Fee {
  nom: number
  denom: number
}

interface PairInfoReply {
  get_pair_info?: {
    amount_0: string
    amount_1: string
    fee_info: { lp_fee: Fee; shade_dao_fee: Fee }
  }
}

const PAGE = 30
const MAX_PAGES = 20

let pairsCache: Promise<Pair[]> | undefined

/**
 * Every enabled constant-product pair the factory knows. Cached for the page:
 * pairs are added rarely, and the reserves — which do change — are read fresh
 * for every quote.
 */
export function listPairs(client: SecretNetworkClient): Promise<Pair[]> {
  pairsCache ??= (async () => {
    const pairs: Pair[] = []
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const reply = (await client.query.compute.queryContract({
        contract_address: SHADESWAP_FACTORY.address,
        code_hash: SHADESWAP_FACTORY.codeHash,
        query: { list_a_m_m_pairs: { pagination: { start: page * PAGE, limit: PAGE } } }
      })) as FactoryPairsReply
      const batch = reply?.list_a_m_m_pairs?.amm_pairs ?? []
      for (const entry of batch) {
        const [a, b, stable] = entry.pair
        if (!entry.enabled || stable || !a.custom_token || !b.custom_token) continue
        pairs.push({
          contract: { address: entry.address, codeHash: entry.code_hash },
          token0: { address: a.custom_token.contract_addr, codeHash: a.custom_token.token_code_hash },
          token1: { address: b.custom_token.contract_addr, codeHash: b.custom_token.token_code_hash }
        })
      }
      if (batch.length < PAGE) break
    }
    return pairs
  })().catch((error: unknown) => {
    // A failed read is not a list with nothing in it; try again next time.
    pairsCache = undefined
    throw error
  })
  return pairsCache
}

function other(pair: Pair, token: string): ContractRef | undefined {
  if (pair.token0.address === token) return pair.token1
  if (pair.token1.address === token) return pair.token0
  return undefined
}

/** Routes from `from` to `to`: every direct pair, then every two-hop path. */
export function findRoutes(pairs: Pair[], from: string, to: string): Route[] {
  const routes: Route[] = []
  const touching = (token: string) => pairs.filter((pair) => other(pair, token))

  for (const pair of touching(from)) {
    const next = other(pair, from)!
    const fromRef = pair.token0.address === from ? pair.token0 : pair.token1
    if (next.address === to) {
      routes.push([{ pair, from: fromRef, to: next }])
      continue
    }
    for (const second of touching(next.address)) {
      if (second === pair) continue
      const end = other(second, next.address)!
      if (end.address === to)
        routes.push([
          { pair, from: fromRef, to: next },
          { pair: second, from: next, to: end }
        ])
    }
  }
  return routes
}

async function reserves(client: SecretNetworkClient, pair: Pair): Promise<Reserves> {
  const reply = (await client.query.compute.queryContract({
    contract_address: pair.contract.address,
    code_hash: pair.contract.codeHash,
    query: { get_pair_info: {} }
  })) as PairInfoReply
  const info = reply?.get_pair_info
  if (!info) throw new Error('The pool did not describe itself.')
  const { lp_fee: lp, shade_dao_fee: dao } = info.fee_info
  return {
    amount0: BigInt(info.amount_0),
    amount1: BigInt(info.amount_1),
    feeNum: BigInt(lp.nom) * BigInt(dao.denom) + BigInt(dao.nom) * BigInt(lp.denom),
    feeDen: BigInt(lp.denom) * BigInt(dao.denom)
  }
}

/** Reserves oriented along a hop: what goes in, what comes out. */
function oriented(hop: Hop, r: Reserves): { input: bigint; output: bigint; feeNum: bigint; feeDen: bigint } {
  const forward = hop.pair.token0.address === hop.from.address
  return {
    input: forward ? r.amount0 : r.amount1,
    output: forward ? r.amount1 : r.amount0,
    feeNum: r.feeNum,
    feeDen: r.feeDen
  }
}

/**
 * shade.js `constantProductSwapToken0for1`: the constant-product output, with
 * the fee taken from what comes out.
 */
export function swapOut(
  input: bigint,
  output: bigint,
  amountIn: bigint,
  feeNum: bigint,
  feeDen: bigint
): bigint {
  if (amountIn <= 0n || input <= 0n || output <= 0n) return 0n
  const gross = (output * amountIn) / (input + amountIn)
  return gross - (gross * feeNum + feeDen - 1n) / feeDen
}

/** The inverse: how much must go in for `amountOut` to come out, rounded up. `undefined` past the pool's depth. */
export function swapIn(
  input: bigint,
  output: bigint,
  amountOut: bigint,
  feeNum: bigint,
  feeDen: bigint
): bigint | undefined {
  if (feeNum >= feeDen) return undefined
  // One unit over, for the fee being rounded up on the way out.
  const gross = (amountOut * feeDen + (feeDen - feeNum) - 1n) / (feeDen - feeNum) + 1n
  if (gross >= output) return undefined
  return (input * gross + (output - gross) - 1n) / (output - gross) + 1n
}

export interface Quote {
  route: Route
  amountIn: bigint
  amountOut: bigint
  /**
   * How much worse than the pools' current price this trade is, in basis
   * points — the damage the trade itself does to the rate it gets.
   */
  impactBps: number
}

async function routeReserves(client: SecretNetworkClient, route: Route) {
  return Promise.all(route.map(async (hop) => oriented(hop, await reserves(client, hop.pair))))
}

function impact(
  legs: Awaited<ReturnType<typeof routeReserves>>,
  amountIn: bigint,
  amountOut: bigint
): number {
  // What `amountIn` would buy at the pools' current price, fees included.
  let spot = amountIn * 10n ** 18n
  for (const leg of legs) spot = (spot * leg.output * (leg.feeDen - leg.feeNum)) / (leg.input * leg.feeDen)
  spot /= 10n ** 18n
  if (spot <= 0n) return 10_000
  return Number(((spot - amountOut) * 10_000n) / spot)
}

/** What `amountIn` buys along `route`, on the reserves as they are now. */
export async function quoteExactIn(
  client: SecretNetworkClient,
  route: Route,
  amountIn: bigint
): Promise<Quote> {
  const legs = await routeReserves(client, route)
  let amount = amountIn
  for (const leg of legs) amount = swapOut(leg.input, leg.output, amount, leg.feeNum, leg.feeDen)
  return { route, amountIn, amountOut: amount, impactBps: impact(legs, amountIn, amount) }
}

/** What has to go in along `route` for `amountOut` to come out, or `undefined` past the pools' depth. */
export async function quoteExactOut(
  client: SecretNetworkClient,
  route: Route,
  amountOut: bigint
): Promise<Quote | undefined> {
  const legs = await routeReserves(client, route)
  let amount: bigint | undefined = amountOut
  for (const leg of [...legs].reverse()) {
    amount = swapIn(leg.input, leg.output, amount, leg.feeNum, leg.feeDen)
    if (amount === undefined) return undefined
  }
  return { route, amountIn: amount, amountOut, impactBps: impact(legs, amount, amountOut) }
}

/** The most a swap here can take: two hops, the longest route `findRoutes` builds. */
export const MAX_SWAP_GAS = withGasBuffer(SWAP_GAS_BASE + SWAP_GAS_PER_HOP * 2)

export function swapGas(route: Route): number {
  return withGasBuffer(SWAP_GAS_BASE + SWAP_GAS_PER_HOP * route.length)
}

function base64Json(value: unknown): string {
  return btoa(JSON.stringify(value))
}

/**
 * shade.js `msgSwapV2`: a SNIP-20 `send` of the input to the router, carrying
 * the path and the minimum return. The output comes back to the sender.
 */
export async function swapMessage(
  sender: string,
  route: Route,
  amountIn: bigint,
  minOut: bigint
): Promise<Msg> {
  const { MsgExecuteContract } = await import('secretjs')
  const first = route[0].from
  const last = route[route.length - 1].to

  const swap = {
    swap_tokens_for_exact: {
      expected_return: {
        amount: minOut.toString(),
        token: { address: last.address, code_hash: last.codeHash }
      },
      path: route.map((hop) => ({
        address: hop.pair.contract.address,
        code_hash: hop.pair.contract.codeHash,
        token0: { address: hop.pair.token0.address, code_hash: hop.pair.token0.codeHash },
        token1: { address: hop.pair.token1.address, code_hash: hop.pair.token1.codeHash }
      }))
    }
  }

  return new MsgExecuteContract({
    sender,
    contract_address: first.address,
    code_hash: first.codeHash,
    msg: {
      send: {
        recipient: SHADESWAP_ROUTER.address,
        recipient_code_hash: SHADESWAP_ROUTER.codeHash,
        amount: amountIn.toString(),
        msg: base64Json(swap)
      }
    },
    sent_funds: []
  })
}

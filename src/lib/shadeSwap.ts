import type { Msg, SecretNetworkClient } from 'secretjs'

import { withGasBuffer } from '@/chains/secret4'
import { batchQuery } from '@/lib/batchQuery'
import { codeHashFor } from '@/lib/codeHash'

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

/**
 * Mainnet addresses, from shade.js `docs/contracts.md`. Their code hashes are
 * read from the chain like every other one (`lib/codeHash.ts`), not copied.
 */
export const SHADESWAP_FACTORY = 'secret1ja0hcwvy76grqkpgwznxukgd7t8a8anmmx05pp'
export const SHADESWAP_ROUTER = 'secret1nrnh30ant2dplrlvqjgmddg4fntllwlm0pnhss'

/** shade.js `MsgCost`: a base plus a fixed cost per constant-product hop. */
const SWAP_GAS_BASE = 300_000
const SWAP_GAS_PER_HOP = 345_000

export interface Pair {
  contract: ContractRef
  token0: ContractRef
  token1: ContractRef
}

export interface Reserves {
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
/** Pages asked for in one batch; another batch follows only if the last page was full. */
const PAGES_PER_BATCH = 8
const MAX_PAGES = 40

const STORAGE_KEY = 'secret-dashboard:shadeswap-pairs:v1'
/** A stored list younger than this is used as it is; an older one is used and refreshed behind. */
const FRESH_MS = 24 * 60 * 60_000

let pairsCache: Promise<Pair[]> | undefined

function stored(): { at: number; pairs: Pair[] } | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as { at: number; pairs: Pair[] }) : undefined
  } catch {
    return undefined
  }
}

function store(pairs: Pair[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ at: Date.now(), pairs }))
  } catch {
    // Only a cache.
  }
}

function toPairs(reply: FactoryPairsReply | undefined): { pairs: Pair[]; count: number } {
  const entries = reply?.list_a_m_m_pairs?.amm_pairs ?? []
  const pairs: Pair[] = []
  for (const entry of entries) {
    const [a, b, stable] = entry.pair
    if (!entry.enabled || stable || !a.custom_token || !b.custom_token) continue
    pairs.push({
      contract: { address: entry.address, codeHash: entry.code_hash },
      token0: { address: a.custom_token.contract_addr, codeHash: a.custom_token.token_code_hash },
      token1: { address: b.custom_token.contract_addr, codeHash: b.custom_token.token_code_hash }
    })
  }
  return { pairs, count: entries.length }
}

/** The factory's pages, several per request through the batch router. */
async function fetchPairs(client: SecretNetworkClient): Promise<Pair[]> {
  const factory = { address: SHADESWAP_FACTORY, codeHash: await codeHashFor(client, SHADESWAP_FACTORY) }
  const pairs: Pair[] = []
  for (let first = 0; first < MAX_PAGES; first += PAGES_PER_BATCH) {
    const pages = Array.from({ length: PAGES_PER_BATCH }, (_, index) => first + index)
    const answers = await batchQuery(
      client,
      pages.map((page) => ({
        id: String(page),
        contract: factory,
        query: { list_a_m_m_pairs: { pagination: { start: page * PAGE, limit: PAGE } } }
      }))
    )
    let full = true
    for (const page of pages) {
      const answer = answers.get(String(page))
      if (!answer?.ok) throw new Error('The ShadeSwap factory did not list its pairs.')
      const { pairs: found, count } = toPairs(answer.value as FactoryPairsReply)
      pairs.push(...found)
      if (count < PAGE) {
        full = false
        break
      }
    }
    if (!full) break
  }
  return pairs
}

/**
 * Every enabled constant-product pair the factory knows.
 *
 * Pairs are added rarely, so the list is kept in the browser and used at once
 * on the next visit — refreshed in the background once it is a day old. The
 * reserves, which do change, are always read fresh for a quote.
 */
export function listPairs(client: SecretNetworkClient): Promise<Pair[]> {
  if (pairsCache) return pairsCache

  const refresh = () =>
    fetchPairs(client).then((pairs) => {
      store(pairs)
      pairsCache = Promise.resolve(pairs)
      return pairs
    })

  const kept = stored()
  if (kept && kept.pairs.length > 0) {
    pairsCache = Promise.resolve(kept.pairs)
    if (Date.now() - kept.at > FRESH_MS) void refresh().catch(() => undefined)
    return pairsCache
  }

  pairsCache = refresh().catch((error: unknown) => {
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

function parseReserves(reply: PairInfoReply): Reserves | undefined {
  const info = reply?.get_pair_info
  if (!info) return undefined
  const { lp_fee: lp, shade_dao_fee: dao } = info.fee_info
  return {
    amount0: BigInt(info.amount_0),
    amount1: BigInt(info.amount_1),
    feeNum: BigInt(lp.nom) * BigInt(dao.denom) + BigInt(dao.nom) * BigInt(lp.denom),
    feeDen: BigInt(lp.denom) * BigInt(dao.denom)
  }
}

/** The pools' reserves as they are now, by pair address — every pool in one request. */
export async function reservesFor(
  client: SecretNetworkClient,
  pairs: Pair[]
): Promise<Map<string, Reserves>> {
  const unique = [...new Map(pairs.map((pair) => [pair.contract.address, pair])).values()]
  const answers = await batchQuery(
    client,
    unique.map((pair) => ({
      id: pair.contract.address,
      contract: pair.contract,
      query: { get_pair_info: {} }
    }))
  )
  const found = new Map<string, Reserves>()
  for (const pair of unique) {
    const answer = answers.get(pair.contract.address)
    const parsed = answer?.ok ? parseReserves(answer.value as PairInfoReply) : undefined
    if (parsed) found.set(pair.contract.address, parsed)
  }
  return found
}

/** Every pair a set of routes passes through. */
export function pairsOf(routes: Route[]): Pair[] {
  return routes.flatMap((route) => route.map((hop) => hop.pair))
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

type Leg = ReturnType<typeof oriented>

function legsOf(route: Route, reserves: Map<string, Reserves>): Leg[] | undefined {
  const legs: Leg[] = []
  for (const hop of route) {
    const found = reserves.get(hop.pair.contract.address)
    if (!found) return undefined
    legs.push(oriented(hop, found))
  }
  return legs
}

function impact(legs: Leg[], amountIn: bigint, amountOut: bigint): number {
  // What `amountIn` would buy at the pools' current price, fees included.
  let spot = amountIn * 10n ** 18n
  for (const leg of legs) spot = (spot * leg.output * (leg.feeDen - leg.feeNum)) / (leg.input * leg.feeDen)
  spot /= 10n ** 18n
  if (spot <= 0n) return 10_000
  return Number(((spot - amountOut) * 10_000n) / spot)
}

/** What `amountIn` buys along `route`, on reserves already read. */
export function quoteIn(route: Route, reserves: Map<string, Reserves>, amountIn: bigint): Quote | undefined {
  const legs = legsOf(route, reserves)
  if (!legs) return undefined
  let amount = amountIn
  for (const leg of legs) amount = swapOut(leg.input, leg.output, amount, leg.feeNum, leg.feeDen)
  return { route, amountIn, amountOut: amount, impactBps: impact(legs, amountIn, amount) }
}

/** What has to go in along `route` for `amountOut` to come out, or `undefined` past the pools' depth. */
export function quoteOut(
  route: Route,
  reserves: Map<string, Reserves>,
  amountOut: bigint
): Quote | undefined {
  const legs = legsOf(route, reserves)
  if (!legs) return undefined
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
  client: SecretNetworkClient,
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
        recipient: SHADESWAP_ROUTER,
        recipient_code_hash: await codeHashFor(client, SHADESWAP_ROUTER),
        amount: amountIn.toString(),
        msg: base64Json(swap)
      }
    },
    sent_funds: []
  })
}

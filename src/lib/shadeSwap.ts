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
 * Constant-product pools are priced here: their output is exact arithmetic
 * on the reserves, done in integers, with no request beyond reading them.
 * Stable pools price through an oracle and an iterative solver, and getting
 * that slightly wrong is how a swap fails or overpays — so a route through
 * one is priced by the chain itself, with the router's own `swap_simulation`
 * (`quoteOutSimulated`). Some tokens have no other way in: every ATOM pool
 * with real depth is a stable one.
 *
 * Routes are up to three hops, through any tokens that pair up.
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
/**
 * What a stable hop costs on top: shade.js adds its oracles' reads (about
 * 240k each, two per pool) and the solver's iterations (2,250 each).
 */
const STABLE_HOP_EXTRA_GAS = 1_000_000
/** The longest route `findRoutes` builds. */
const MAX_HOPS = 3
/** Routes considered per quote, shortest first; their pools are read in one request. */
const MAX_ROUTES = 16
/** Stable routes priced by simulation per quote, all in the first request. */
const MAX_SIMULATED_ROUTES = 6

export interface Pair {
  contract: ContractRef
  /**
   * The code hashes here are the pair's own record of its tokens, which the
   * router checks a swap's path against — not necessarily a token's current
   * hash, if it has been migrated since. Anything sent to the token itself
   * uses `codeHashFor`.
   */
  token0: ContractRef
  token1: ContractRef
  stable: boolean
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

const STORAGE_KEY = 'secret-dashboard:shadeswap-pairs:v2'
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
    if (!entry.enabled || !a.custom_token || !b.custom_token) continue
    pairs.push({
      contract: { address: entry.address, codeHash: entry.code_hash },
      token0: { address: a.custom_token.contract_addr, codeHash: a.custom_token.token_code_hash },
      token1: { address: b.custom_token.contract_addr, codeHash: b.custom_token.token_code_hash },
      stable
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
 * Every enabled pair the factory knows, stable ones included.
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

/**
 * Routes from `from` to `to`, up to `MAX_HOPS` long, never through the same
 * token twice — shortest first, and at most `MAX_ROUTES` of them.
 */
export function findRoutes(pairs: Pair[], from: string, to: string): Route[] {
  const routes: Route[] = []
  const byToken = new Map<string, Pair[]>()
  for (const pair of pairs) {
    for (const token of [pair.token0.address, pair.token1.address]) {
      byToken.set(token, [...(byToken.get(token) ?? []), pair])
    }
  }

  const walk = (at: string, path: Hop[], seen: Set<string>) => {
    for (const pair of byToken.get(at) ?? []) {
      const next = other(pair, at)!
      if (seen.has(next.address)) continue
      const hop = { pair, from: pair.token0.address === at ? pair.token0 : pair.token1, to: next }
      if (next.address === to) routes.push([...path, hop])
      else if (path.length + 1 < MAX_HOPS)
        walk(next.address, [...path, hop], new Set([...seen, next.address]))
    }
  }
  walk(from, [], new Set([from]))

  return routes.sort((a, b) => a.length - b.length).slice(0, MAX_ROUTES)
}

export function isSimulated(route: Route): boolean {
  return route.some((hop) => hop.pair.stable)
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

/** The route's pools as arithmetic — none, if it passes through a stable pool, which this cannot price. */
function legsOf(route: Route, reserves: Map<string, Reserves>): Leg[] | undefined {
  if (isSimulated(route)) return undefined
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

/**
 * The most a swap here can take: the longest route `findRoutes` builds, with
 * all but one hop stable — a route can hardly pass through three stable pools
 * without a token repeating.
 */
export const MAX_SWAP_GAS = withGasBuffer(
  SWAP_GAS_BASE + SWAP_GAS_PER_HOP * MAX_HOPS + STABLE_HOP_EXTRA_GAS * (MAX_HOPS - 1)
)

export function swapGas(route: Route): number {
  const stableHops = route.filter((hop) => hop.pair.stable).length
  return withGasBuffer(SWAP_GAS_BASE + SWAP_GAS_PER_HOP * route.length + STABLE_HOP_EXTRA_GAS * stableHops)
}

/* -------------------------------------------------------------------------- */
/* Pricing by simulation, for routes through stable pools                      */
/* -------------------------------------------------------------------------- */

function tokenType(token: ContractRef) {
  return { custom_token: { contract_addr: token.address, token_code_hash: token.codeHash } }
}

interface SimulationReply {
  swap_simulation?: { result?: { return_amount?: string } }
}

/**
 * What each `amountIn` returns along its route, as the router works it out —
 * every one in a single request. `undefined` for a route it would not price.
 */
export async function simulate(
  client: SecretNetworkClient,
  trades: Array<{ route: Route; amountIn: bigint }>
): Promise<Array<bigint | undefined>> {
  if (trades.length === 0) return []
  const router = { address: SHADESWAP_ROUTER, codeHash: await codeHashFor(client, SHADESWAP_ROUTER) }
  const answers = await batchQuery(
    client,
    trades.map(({ route, amountIn }, index) => ({
      id: String(index),
      contract: router,
      query: {
        swap_simulation: {
          // The token as the first pool records it, which is what the router matches on.
          offer: { token: tokenType(route[0].from), amount: amountIn.toString() },
          path: route.map((hop) => ({
            address: hop.pair.contract.address,
            code_hash: hop.pair.contract.codeHash,
            pair: [tokenType(hop.pair.token0), tokenType(hop.pair.token1), hop.pair.stable]
          }))
        }
      }
    }))
  )
  return trades.map((_, index) => {
    const answer = answers.get(String(index))
    const amount = answer?.ok
      ? (answer.value as SimulationReply).swap_simulation?.result?.return_amount
      : undefined
    return amount !== undefined && /^\d+$/.test(amount) ? BigInt(amount) : undefined
  })
}

/** Rounds of simulation before a route that has not converged is given up on. */
const SIMULATION_ROUNDS = 6
/** Close enough: what comes out may exceed the target by this much, in basis points. */
const OVERSHOOT_BPS = 30n

/**
 * A first guess at what `amountOut` costs along `route`, from the pools'
 * reserves as if every one were constant-product. For a stable pool that can be
 * off by its tokens' exchange rate — the rounds after correct it.
 */
function roughIn(route: Route, reserves: Map<string, Reserves>, amountOut: bigint): bigint | undefined {
  let amount = amountOut
  for (const hop of [...route].reverse()) {
    const found = reserves.get(hop.pair.contract.address)
    if (!found) return undefined
    const { input, output } = oriented(hop, found)
    if (input <= 0n || output <= 0n) return undefined
    amount = (amount * input) / output + 1n
  }
  return amount
}

/**
 * What `amountOut` costs along `route`, found by asking the router: `guess`,
 * then the guess scaled by how far it fell short or overshot, until what
 * comes out is at least `amountOut` and not by much more. A round per request.
 */
async function refine(
  client: SecretNetworkClient,
  route: Route,
  amountOut: bigint,
  guess: bigint
): Promise<bigint | undefined> {
  for (let round = 0; round < SIMULATION_ROUNDS; round += 1) {
    const [out] = await simulate(client, [{ route, amountIn: guess }])
    if (out === undefined || out <= 0n) return undefined
    if (out >= amountOut && (out - amountOut) * 10_000n <= amountOut * OVERSHOOT_BPS) return guess
    // Aim a little over, so the next round lands on the right side of it.
    const scaled = (guess * amountOut * (10_000n + OVERSHOOT_BPS / 3n)) / (out * 10_000n) + 1n
    guess = scaled === guess ? scaled + 1n : scaled
  }
  return undefined
}

/**
 * The cheapest of `routes` — ones through a stable pool — for `amountOut`,
 * priced by the router, with the slippage `padFor` sets from its price impact
 * already in: `amountOut` in the answer is the padded figure, the one a swap
 * can promise as its minimum.
 *
 * Kept to as few requests as it can. One prices every route at a first guess,
 * and at a hundredth of it for the rate the impact is measured against — enough
 * to rank them. Only the best is refined, straight to the padded amount; and
 * not even that when it cannot come in under `beat`, what arithmetic on a
 * constant-product route already found.
 */
export async function bestSimulated(
  client: SecretNetworkClient,
  routes: Route[],
  reserves: Map<string, Reserves>,
  amountOut: bigint,
  padFor: (impactBps: number) => bigint,
  beat?: bigint
): Promise<(Quote & { slippageBps: bigint }) | undefined> {
  if (amountOut <= 0n) return undefined
  const candidates = routes
    .slice(0, MAX_SIMULATED_ROUTES)
    .map((route) => ({ route, guess: roughIn(route, reserves, amountOut) }))
    .filter((entry): entry is { route: Route; guess: bigint } => entry.guess !== undefined)
  if (candidates.length === 0) return undefined

  const probeIn = (guess: bigint) => guess / 100n + 1n
  const outs = await simulate(client, [
    ...candidates.map(({ route, guess }) => ({ route, amountIn: guess })),
    ...candidates.map(({ route, guess }) => ({ route, amountIn: probeIn(guess) }))
  ])
  const best = candidates
    .flatMap(({ route, guess }, index) => {
      const out = outs[index]
      if (out === undefined || out <= 0n) return []
      return [
        {
          route,
          estimate: (guess * amountOut) / out + 1n,
          impactBps: simulatedImpact(guess, out, probeIn(guess), outs[candidates.length + index])
        }
      ]
    })
    .sort((a, b) => (a.estimate === b.estimate ? 0 : a.estimate < b.estimate ? -1 : 1))[0]
  if (!best) return undefined

  const slippageBps = padFor(best.impactBps)
  const padded = (amountOut * 10_000n) / (10_000n - slippageBps)
  const start = (best.estimate * padded) / amountOut + 1n
  if (beat !== undefined && start > beat) return undefined

  const amountIn = await refine(client, best.route, padded, start)
  if (amountIn === undefined) return undefined
  return { route: best.route, amountIn, amountOut: padded, impactBps: best.impactBps, slippageBps }
}

function simulatedImpact(
  amountIn: bigint,
  out: bigint,
  probeIn: bigint,
  probeOut: bigint | undefined
): number {
  if (!probeOut || probeOut <= 0n) return 0
  // Rate for the trade against the rate for a sliver of it, scaled up.
  const spot = (probeOut * amountIn) / probeIn
  if (spot <= out) return 0
  return Number(((spot - out) * 10_000n) / spot)
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
  // The pair's record of a token's hash can predate a migration (USDC's
  // does); the token itself only answers to its current one.
  const [tokenHash, routerHash] = await Promise.all([
    codeHashFor(client, first.address),
    codeHashFor(client, SHADESWAP_ROUTER)
  ])

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
    code_hash: tokenHash,
    msg: {
      send: {
        recipient: SHADESWAP_ROUTER,
        recipient_code_hash: routerHash,
        amount: amountIn.toString(),
        msg: base64Json(swap)
      }
    },
    sent_funds: []
  })
}

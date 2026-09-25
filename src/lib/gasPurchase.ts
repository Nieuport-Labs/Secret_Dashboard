import type { Msg, SecretNetworkClient } from 'secretjs'

import { DENOM, GAS, GAS_BUFFER, GAS_PRICE_USCRT, GAS_VAULT_ADDRESS } from '@/chains/secret4'
import { codeHashFor } from '@/lib/codeHash'
import { mapWithLimit } from '@/lib/concurrency'
import { estimateFee } from '@/lib/feegrant-sdk'
import { gasLimitFor, rememberGasUsed } from '@/lib/gasMemory'
import { covers, type Permit } from '@/lib/permit'
import {
  bestSimulated,
  findRoutes,
  isSimulated,
  listPairs,
  pairsOf,
  quoteOut,
  reservesFor,
  swapGas,
  type Quote,
  type Reserves,
  type Route
} from '@/lib/shadeSwap'
import { permitAuth, queryBalance, redeemMsg } from '@/lib/snip20'
import { loadWatchlist } from '@/lib/watchlist'
import { allTokenAddresses, SSCRT_ADDRESS, STKD_SCRT_ADDRESS } from '@/tokens/registry'

/**
 * Buying gas credits with something other than public SCRT, in one
 * transaction: optionally swap a token for sSCRT on ShadeSwap, unwrap the sSCRT,
 * and pay the SCRT that frees into the gas vault.
 *
 * Shared by auto-refill (`lib/autoRefill.ts`), which does it unasked, and the
 * gas credits dialog, where someone picks the token themselves.
 */

/**
 * How far under its quote a swap's minimum return may sit, set per trade from
 * how much that trade moves the pools' price: at least 1%, as much as the
 * price impact above that, and never more than 5%. A trade that moves the
 * price further than that still goes through at the price quoted — the impact
 * is already in the quote — it just is not given more room than 5% on top.
 */
export const MIN_SLIPPAGE_BPS = 100
export const MAX_SLIPPAGE_BPS = 500

export function slippageFor(impactBps: number): bigint {
  return BigInt(Math.min(MAX_SLIPPAGE_BPS, Math.max(MIN_SLIPPAGE_BPS, Math.ceil(impactBps))))
}

/** A quote with the slippage it was padded by. */
export type PaddedQuote = Quote & { slippageBps: bigint }

/** Unwrap plus the vault's execute; a swap adds its own. */
export const PURCHASE_GAS = GAS.unwrap + GAS.buyGasCredit

/**
 * A purchase's shape for `lib/gasMemory.ts`: the token it swaps and every pool
 * on the way, since each token contract and each pool costs its own gas.
 */
function purchaseShape(route?: Route): string {
  return route
    ? `buy-credits:${route[0].from.address}>${route.map((hop) => hop.pair.contract.address).join('>')}`
    : 'buy-credits:sscrt'
}

/**
 * The most gas a purchase may ask for: 0.1 SCRT at the lowest gas price, which
 * is what the community faucet grants someone with nothing else to pay with.
 * A purchase is the way out of having no gas; it must never cost more than
 * that way out provides.
 */
export const MAX_PURCHASE_GAS = 2_000_000

function estimatedPurchaseGas(route?: Route): number {
  return PURCHASE_GAS + (route ? swapGas(route) : 0)
}

/**
 * Whether a purchase along `route` fits `MAX_PURCHASE_GAS` by its estimate
 * before the safety margin — the margin may be trimmed to fit, the estimate
 * itself may not. Routes that do not are never offered for buying credits.
 */
export function purchaseFits(route?: Route): boolean {
  return Math.floor(estimatedPurchaseGas(route) / GAS_BUFFER) <= MAX_PURCHASE_GAS
}

/**
 * The gas limit for buying credits out of sSCRT, after swapping along `route`
 * when there is one: what the same purchase used last time, with a small
 * margin, or the hand-sized estimate until it has been seen — never more than
 * `MAX_PURCHASE_GAS`. (A 3-hop swap measured 1.41M in all, which leaves the
 * unwrap and the vault room under it.)
 */
export function purchaseGas(route?: Route): number {
  return Math.min(MAX_PURCHASE_GAS, gasLimitFor(purchaseShape(route), estimatedPurchaseGas(route)))
}

/** Record what a purchase that went through actually used, for `purchaseGas`. */
export function rememberPurchaseGas(route: Route | undefined, gasUsed: number): void {
  rememberGasUsed(purchaseShape(route), gasUsed)
}

/**
 * Buy `total` of credit for `address`, of which `unwrap` comes out of sSCRT
 * and the rest from the public SCRT balance. `swap`, when there is one, runs
 * first, so the sSCRT it returns is in the balance the unwrap draws on.
 */
export async function purchaseMessages(
  client: SecretNetworkClient,
  address: string,
  { unwrap, total }: { unwrap: bigint; total: bigint },
  swap?: Msg
): Promise<Msg[]> {
  const { MsgExecuteContract } = await import('secretjs')
  const [sscrtHash, vaultHash] = await Promise.all([
    codeHashFor(client, SSCRT_ADDRESS),
    codeHashFor(client, GAS_VAULT_ADDRESS)
  ])

  return [
    ...(swap ? [swap] : []),
    ...(unwrap > 0n
      ? [
          new MsgExecuteContract({
            sender: address,
            contract_address: SSCRT_ADDRESS,
            code_hash: sscrtHash,
            msg: redeemMsg(unwrap.toString()),
            sent_funds: []
          })
        ]
      : []),
    // Runs after the unwrap above has put the SCRT in the bank balance.
    new MsgExecuteContract({
      sender: address,
      contract_address: GAS_VAULT_ADDRESS,
      code_hash: vaultHash,
      msg: { grant: { grantee: address } },
      sent_funds: [{ denom: DENOM, amount: total.toString() }]
    })
  ]
}

/**
 * Tokens that can be swapped for `target` (sSCRT unless said otherwise):
 * covered by the permit, so their balance can be read, with a route there,
 * and not stkd-SCRT — a staking position someone chose, not spare change.
 */
export async function swappableTokens(
  client: SecretNetworkClient,
  permit: Permit,
  target: string = SSCRT_ADDRESS
): Promise<string[]> {
  const pairs = await listPairs(client)
  return allTokenAddresses().filter(
    (token) =>
      token !== target &&
      token !== STKD_SCRT_ADDRESS &&
      covers(permit, token) &&
      findRoutes(pairs, token, target).some((route) => target !== SSCRT_ADDRESS || purchaseFits(route))
  )
}

/**
 * What a route's own transaction costs in fees, in units of what comes out —
 * when that is SCRT or sSCRT, simply its fee in uscrt. A longer route can buy
 * a little more per token and still cost more once its extra hops are paid for,
 * and for the small amounts gas credits are bought in, a hop's fee is not
 * small: so routes are compared on both.
 */
export type GasCost = (route: Route) => bigint

/** `quote`'s price plus its route's fee, in the input token: what it really costs. */
function totalCost(quote: Quote, gasCost?: GasCost): bigint {
  if (!gasCost || quote.amountOut <= 0n) return quote.amountIn
  return quote.amountIn + (gasCost(quote.route) * quote.amountIn) / quote.amountOut
}

function cheapestOf(quotes: Quote[], gasCost?: GasCost): Quote | undefined {
  return quotes
    .map((quote) => ({ quote, cost: totalCost(quote, gasCost) }))
    .sort((a, b) => (a.cost === b.cost ? 0 : a.cost < b.cost ? -1 : 1))[0]?.quote
}

/**
 * The cheapest way along `routes` to get `amount` out, padded by the slippage
 * its own price impact calls for — so `amount` is what the swap can promise as
 * its minimum. Pure arithmetic on reserves already read: the impact and the
 * padded figure come from the same read, not two.
 */
export function bestExactOut(
  routes: Route[],
  reserves: Map<string, Reserves>,
  amount: bigint,
  gasCost?: GasCost
): PaddedQuote | undefined {
  const quotesFor = (candidates: Route[], out: bigint) =>
    candidates
      .map((route) => quoteOut(route, reserves, out))
      .filter((quote): quote is Quote => quote !== undefined)

  const bare = cheapestOf(quotesFor(routes, amount), gasCost)
  if (!bare) return undefined
  const slippageBps = slippageFor(bare.impactBps)
  const [padded] = quotesFor([bare.route], (amount * 10_000n) / (10_000n - slippageBps))
  return padded ? { ...padded, slippageBps } : undefined
}

/**
 * `bestExactOut` over every kind of route: constant-product ones by
 * arithmetic, and those through a stable pool by asking the router
 * (`bestSimulated`) — which only goes as far as it has to, to beat them.
 */
export async function bestExactOutAnywhere(
  client: SecretNetworkClient,
  routes: Route[],
  reserves: Map<string, Reserves>,
  amount: bigint,
  gasCost?: GasCost
): Promise<PaddedQuote | undefined> {
  const local = bestExactOut(
    routes.filter((route) => !isSimulated(route)),
    reserves,
    amount,
    gasCost
  )
  const stable = routes.filter(isSimulated)
  if (stable.length === 0) return local
  // Fees only make a stable route dearer, so one whose price alone cannot
  // beat the best constant-product total is not worth refining.
  const simulated = await bestSimulated(
    client,
    stable,
    reserves,
    amount,
    slippageFor,
    local ? totalCost(local, gasCost) : undefined
  ).catch(() => undefined)
  if (!simulated) return local
  if (!local) return simulated
  return totalCost(simulated, gasCost) < totalCost(local, gasCost) ? simulated : local
}

/**
 * What it costs in `token` to get `amount` of `target` out, slippage
 * included. Every pool on every route read in one request.
 */
export async function quoteInto(
  client: SecretNetworkClient,
  token: string,
  target: string,
  amount: bigint,
  gasCost?: GasCost,
  allow: (route: Route) => boolean = () => true
): Promise<PaddedQuote | undefined> {
  const routes = findRoutes(await listPairs(client), token, target).filter(allow)
  if (routes.length === 0) return undefined
  return bestExactOutAnywhere(client, routes, await reservesFor(client, pairsOf(routes)), amount, gasCost)
}

/**
 * Private balances of the tokens among `tokens` this account is known to
 * hold — the wallet's watchlist, filled by its balance sweeps — plus
 * `always`, which is read regardless. Not the whole list: every balance is an
 * encrypted query of its own (a permit is too large to batch, see
 * `lib/batchQuery.ts`), and reading dozens of tokens someone never held is
 * most of the wait for nothing. A token whose balance could not be read is
 * left out, never reported as zero.
 */
export async function balancesOf(
  client: SecretNetworkClient,
  permit: Permit,
  owner: string,
  tokens: string[],
  always: string[] = []
): Promise<Map<string, bigint>> {
  const watched = new Set(loadWatchlist(owner))
  const asked = [...new Set([...always, ...tokens.filter((token) => watched.has(token))])].filter((token) =>
    covers(permit, token)
  )
  const outcomes = await mapWithLimit(asked, 6, (token) => queryBalance(client, permitAuth(permit), token))

  const balances = new Map<string, bigint>()
  asked.forEach((token, index) => {
    const outcome = outcomes[index]
    if (outcome.status === 'ok') balances.set(token, BigInt(outcome.amount))
  })
  return balances
}

/** `quoteInto` for sSCRT, which is what gas credits are bought with. */
export function quoteForSscrt(
  client: SecretNetworkClient,
  token: string,
  amount: bigint
): Promise<PaddedQuote | undefined> {
  // sSCRT is SCRT, so a route's fee in uscrt is already in units of the output.
  return quoteInto(
    client,
    token,
    SSCRT_ADDRESS,
    amount,
    (route) => BigInt(estimateFee(purchaseGas(route), GAS_PRICE_USCRT)),
    purchaseFits
  )
}

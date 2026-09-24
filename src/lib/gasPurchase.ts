import type { Msg, SecretNetworkClient } from 'secretjs'

import { DENOM, GAS, GAS_VAULT_ADDRESS } from '@/chains/secret4'
import { codeHashFor } from '@/lib/codeHash'
import { covers, type Permit } from '@/lib/permit'
import { findRoutes, listPairs, quoteExactOut, type Quote, type Route } from '@/lib/shadeSwap'
import { redeemMsg } from '@/lib/snip20'
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
 * covered by the permit, so their balance can be read, with a constant-product
 * route, and not stkd-SCRT — a staking position someone chose, not spare change.
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
      findRoutes(pairs, token, target).length > 0
  )
}

/**
 * What it costs in `token` to get `amount` of `target` out, slippage
 * included: the quote targets `amount` plus the slippage margin, so `amount`
 * is what the swap can promise as its minimum. The cheapest of up to four
 * routes.
 */
export async function quoteInto(
  client: SecretNetworkClient,
  token: string,
  target: string,
  amount: bigint
): Promise<PaddedQuote | undefined> {
  const pairs = await listPairs(client)
  const cheapest = async (routes: Route[], out: bigint) =>
    (await Promise.all(routes.map((route) => quoteExactOut(client, route, out).catch(() => undefined))))
      .filter((quote): quote is Quote => quote !== undefined)
      .sort((a, b) => (a.amountIn === b.amountIn ? 0 : a.amountIn < b.amountIn ? -1 : 1))[0]

  // The trade as asked, to see how much it moves the price; then the same
  // route again, padded by the slippage that impact calls for.
  const bare = await cheapest(findRoutes(pairs, token, target).slice(0, 4), amount)
  if (!bare) return undefined
  const slippageBps = slippageFor(bare.impactBps)
  const padded = await cheapest([bare.route], (amount * 10_000n) / (10_000n - slippageBps))
  return padded ? { ...padded, slippageBps } : undefined
}

/** `quoteInto` for sSCRT, which is what gas credits are bought with. */
export function quoteForSscrt(
  client: SecretNetworkClient,
  token: string,
  amount: bigint
): Promise<PaddedQuote | undefined> {
  return quoteInto(client, token, SSCRT_ADDRESS, amount)
}

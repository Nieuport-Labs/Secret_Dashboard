import type { Msg } from 'secretjs'

import { DENOM, GAS, GAS_VAULT_ADDRESS } from '@/chains/secret4'
import { codeHashFor } from '@/lib/codeHash'
import { covers, loadPermit, type Permit } from '@/lib/permit'
import {
  findRoutes,
  listPairs,
  quoteExactIn,
  quoteExactOut,
  swapGas,
  swapMessage,
  type Quote
} from '@/lib/shadeSwap'
import { permitAuth, queryBalance, queryBalances, redeemMsg } from '@/lib/snip20'
import { useFeePayer, vaultCredit } from '@/store/feePayer'
import { useNotifications } from '@/store/notifications'
import { useSettings } from '@/store/settings'
import { useWallet } from '@/store/wallet'
import { allTokenAddresses, SSCRT_ADDRESS, STKD_SCRT_ADDRESS } from '@/tokens/registry'

/**
 * Auto-refill of gas credits: the `autorefill` answer to the first-run
 * question, carried out.
 *
 * Whenever the account's gas credits are below 5 SCRT, the next transaction
 * it sends through `sendTx` carries two more messages: unwrap up to 5 sSCRT,
 * and pay the SCRT that frees straight into the gas vault for this address.
 * Both run inside the same transaction, after the user's own messages, so the
 * refill costs no extra prompt.
 *
 * With less than 5 sSCRT, the difference is bought first, in the same
 * transaction, by swapping another token on ShadeSwap (`planSwap` picks which).
 * With no token to swap, the refill uses what sSCRT there is; with nothing at
 * all, it says where to get some instead.
 *
 * The same rules as the profile write that also rides along (see `sendTx`):
 * the refill must never be why someone's own transaction failed. So it is left
 * off whenever it would change who pays the fee, and a bundle that fails
 * because of it is sent again without it.
 */

/** Refill below this, and by this much. 5 SCRT, in base units. */
export const CREDIT_FLOOR = 5_000_000n

export const REFILL_GAS = GAS.unwrap + GAS.buyGasCredit

export const SHADE_SWAP_URL = 'https://app.shadeprotocol.io/swap'

/**
 * A refill just sent (or just refused) is not tried again for a while: the
 * grant list takes a moment to show the new credit, and a second transaction
 * sent in that moment would otherwise refill twice.
 */
const COOLDOWN_MS = 2 * 60_000
/** How often the "no sSCRT to refill with" notice may come back. */
const NOTICE_EVERY_MS = 30 * 60_000

/** The swap's minimum return sits this far under its quote. */
const SLIPPAGE_BPS = 100n
/** A trade that moves the pools' price by more than this is not made. */
const MAX_IMPACT_BPS = 300
/** Less SCRT than this out of a swap is not worth its gas. */
const MIN_SWAP_OUT = 50_000n

let pausedUntil = 0
let noticedAt = 0

export function pauseRefill(): void {
  pausedUntil = Date.now() + COOLDOWN_MS
}

export interface Refill {
  messages: Msg[]
  gas: number
  /** Base units of SCRT that go to the vault. */
  amount: bigint
}

/** How much to refill with, given the credit left and the sSCRT held. Zero means nothing to refill with. */
export function refillAmount(credit: bigint, sscrt: bigint): bigint | undefined {
  if (credit >= CREDIT_FLOOR) return undefined
  return sscrt < CREDIT_FLOOR ? sscrt : CREDIT_FLOOR
}

function noticeNoSscrt(): void {
  if (Date.now() - noticedAt < NOTICE_EVERY_MS) return
  noticedAt = Date.now()
  useNotifications.getState().push({
    kind: 'gas-empty',
    message:
      'Your gas credits are below 5 and there is nothing to refill them with — no sSCRT, and no token to swap for it. You can get SCRT/sSCRT on Shade Swap.'
  })
}

interface SwapPlan {
  message: Msg
  gas: number
  /** sSCRT the swap is guaranteed to return; the router refuses anything less. */
  minOut: bigint
}

/**
 * Which token to swap for `need` of sSCRT, and how.
 *
 * Automatic, and deliberately plain about it: the token the account holds the
 * most of, measured in what it would fetch in SCRT. That spends the smallest
 * share of anything, and the largest holding is also the one most likely to
 * cover the whole amount in one go. stkd-SCRT is left alone — it is a staking
 * position someone chose, not spare change.
 *
 * The chosen token pays for exactly `need` (plus slippage) when it can; when
 * it cannot, its whole balance goes, and the refill is smaller. A token whose
 * trade would move the pool's price by more than 3% is passed over for the
 * next one rather than sold at a bad rate.
 */
async function planSwap(address: string, permit: Permit, need: bigint): Promise<SwapPlan | undefined> {
  const { queryClient } = useWallet.getState()
  if (!queryClient || need <= 0n) return undefined

  const pairs = await listPairs(queryClient)
  const routable = allTokenAddresses()
    .filter((token) => token !== SSCRT_ADDRESS && token !== STKD_SCRT_ADDRESS && covers(permit, token))
    .map((token) => ({ token, routes: findRoutes(pairs, token, SSCRT_ADDRESS).slice(0, 4) }))
    .filter((candidate) => candidate.routes.length > 0)
  if (routable.length === 0) return undefined

  const balances = await queryBalances(
    queryClient,
    permitAuth(permit),
    routable.map((candidate) => candidate.token)
  )

  // What each whole holding would fetch, by its best route.
  const valued: Array<{ balance: bigint; best: Quote; routes: (typeof routable)[number]['routes'] }> = []
  for (const candidate of routable) {
    const outcome = balances.get(candidate.token)
    const balance = outcome?.status === 'ok' ? BigInt(outcome.amount) : 0n
    if (balance <= 0n) continue
    const quotes = await Promise.all(
      candidate.routes.map((route) => quoteExactIn(queryClient, route, balance).catch(() => undefined))
    )
    const best = quotes
      .filter((quote): quote is Quote => quote !== undefined)
      .sort((a, b) => (a.amountOut === b.amountOut ? 0 : a.amountOut > b.amountOut ? -1 : 1))[0]
    if (best && best.amountOut > 0n) valued.push({ balance, best, routes: candidate.routes })
  }
  valued.sort((a, b) =>
    a.best.amountOut === b.best.amountOut ? 0 : a.best.amountOut > b.best.amountOut ? -1 : 1
  )

  const target = (need * 10_000n) / (10_000n - SLIPPAGE_BPS)
  for (const { balance, best, routes } of valued) {
    // Enough to cover `need` with room for slippage: pay only for that.
    const exact = (
      await Promise.all(
        routes.map((route) => quoteExactOut(queryClient, route, target).catch(() => undefined))
      )
    )
      .filter((quote): quote is Quote => quote !== undefined && quote.amountIn <= balance)
      .sort((a, b) => (a.amountIn === b.amountIn ? 0 : a.amountIn < b.amountIn ? -1 : 1))[0]

    if (exact && exact.impactBps <= MAX_IMPACT_BPS) {
      return {
        message: await swapMessage(address, exact.route, exact.amountIn, need),
        gas: swapGas(exact.route),
        minOut: need
      }
    }

    // Not enough of it, so all of it.
    if (best.impactBps > MAX_IMPACT_BPS) continue
    const minOut = (best.amountOut * (10_000n - SLIPPAGE_BPS)) / 10_000n
    if (minOut < MIN_SWAP_OUT) continue
    return {
      message: await swapMessage(address, best.route, best.amountIn, minOut),
      gas: swapGas(best.route),
      minOut
    }
  }
  return undefined
}

/**
 * The refill for this account's next transaction, or `undefined` when none is
 * due or it cannot be worked out. Anything it cannot read — the grant list, the
 * sSCRT balance — means no refill rather than a guess.
 */
export async function refillFor(address: string): Promise<Refill | undefined> {
  if (useSettings.getState().gasMode !== 'autorefill') return undefined
  if (Date.now() < pausedUntil) return undefined

  const { queryClient } = useWallet.getState()
  if (!queryClient) return undefined

  // Fresh, not whatever the header last read: this decides whether SCRT moves.
  await useFeePayer.getState().refresh()
  const { grants, error } = useFeePayer.getState()
  if (error) return undefined
  const credit = vaultCredit(grants) ?? 0n
  if (credit >= CREDIT_FLOOR) return undefined

  // sSCRT is private, so its balance needs the permit. Without one there is
  // no way to know what is there, and the refill waits until there is.
  const permit = loadPermit(address)
  if (!permit) return undefined
  const balance = await queryBalance(queryClient, permitAuth(permit), SSCRT_ADDRESS)
  if (balance.status !== 'ok') return undefined

  const sscrt = BigInt(balance.amount)
  let amount = refillAmount(credit, sscrt)
  if (amount === undefined) return undefined

  // Short of 5: buy the rest by swapping something else, in this same
  // transaction. The unwrap below then covers what is held plus what the
  // swap is guaranteed to return.
  const swap =
    amount < CREDIT_FLOOR
      ? await planSwap(address, permit, CREDIT_FLOOR - amount).catch(() => undefined)
      : undefined
  if (swap) amount += swap.minOut

  if (amount === 0n) {
    noticeNoSscrt()
    return undefined
  }

  const { MsgExecuteContract } = await import('secretjs')
  const [sscrtHash, vaultHash] = await Promise.all([
    codeHashFor(queryClient, SSCRT_ADDRESS),
    codeHashFor(queryClient, GAS_VAULT_ADDRESS)
  ])

  return {
    amount,
    gas: REFILL_GAS + (swap?.gas ?? 0),
    messages: [
      // First, when there is one: the swap puts its sSCRT in the balance the
      // unwrap then draws on.
      ...(swap ? [swap.message] : []),
      new MsgExecuteContract({
        sender: address,
        contract_address: SSCRT_ADDRESS,
        code_hash: sscrtHash,
        msg: redeemMsg(amount.toString()),
        sent_funds: []
      }),
      // Runs after the unwrap above has put the SCRT in the bank balance.
      new MsgExecuteContract({
        sender: address,
        contract_address: GAS_VAULT_ADDRESS,
        code_hash: vaultHash,
        msg: { grant: { grantee: address } },
        sent_funds: [{ denom: DENOM, amount: amount.toString() }]
      })
    ]
  }
}

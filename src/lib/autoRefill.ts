import type { Msg } from 'secretjs'

import { GAS, GAS_PRICE_USCRT } from '@/chains/secret4'
import { queryNativeBalance } from '@/lib/bank'
import { estimateFee } from '@/lib/feegrant-sdk'
import { MSG_EXECUTE_CONTRACT } from '@/lib/msgTypes'

import {
  balancesOf,
  bestExactOutAnywhere,
  PURCHASE_GAS,
  purchaseGas,
  purchaseMessages,
  slippageFor,
  swappableTokens
} from '@/lib/gasPurchase'
import { loadPermit, type Permit } from '@/lib/permit'
import {
  findRoutes,
  listPairs,
  MAX_SWAP_GAS,
  pairsOf,
  quoteIn,
  reservesFor,
  swapMessage,
  type Quote,
  type Route
} from '@/lib/shadeSwap'
import { permitAuth, queryBalance } from '@/lib/snip20'
import { useFeePayer, vaultCredit } from '@/store/feePayer'
import { useNotifications } from '@/store/notifications'
import { useSettings } from '@/store/settings'
import { useWallet } from '@/store/wallet'
import { SSCRT_ADDRESS } from '@/tokens/registry'

/**
 * Auto-refill of gas credits: the `autorefill` answer to the first-run
 * question, carried out.
 *
 * Whenever the account's gas credits are below 5 SCRT, the next transaction
 * it sends through `sendTx` carries a purchase of 5 SCRT of credit for this
 * address, after the user's own messages, so the refill costs no extra prompt.
 *
 * It is paid for from, in order (`splitRefill`):
 *
 * 1. sSCRT, unwrapped in the same transaction;
 * 2. public SCRT — all of it, since the credits are what pays fees from now on;
 * 3. whatever is still missing, by swapping another token for sSCRT on
 *    ShadeSwap first (`planSwap` picks which).
 *
 * When all of that comes to less than 5 it buys what it can; when it comes to
 * nothing, it says where to get some instead.
 *
 * The same rules as the profile write that also rides along (see `sendTx`):
 * the refill must never be why someone's own transaction failed. So it is left
 * off whenever it would change who pays the fee, and a bundle that fails
 * because of it is sent again without it.
 */

/** Refill below this, and by this much. 5 SCRT, in base units. */
export const CREDIT_FLOOR = 5_000_000n

export const REFILL_GAS = PURCHASE_GAS

export const SHADE_SWAP_URL = 'https://app.shadeprotocol.io/swap'

/**
 * A refill just sent (or just refused) is not tried again for a while: the
 * grant list takes a moment to show the new credit, and a second transaction
 * sent in that moment would otherwise refill twice.
 */
const COOLDOWN_MS = 2 * 60_000
/** How often the "no sSCRT to refill with" notice may come back. */
const NOTICE_EVERY_MS = 30 * 60_000

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

/**
 * Where a 5 SCRT refill comes from: sSCRT first, then public SCRT, and `short`
 * is what neither covers — the part a swap can buy.
 *
 * No SCRT is held back for later fees; that is what the credits are for. The
 * one exception is `feeFromBalance`: when the credits are too low to pay even
 * for this transaction, its fee comes out of the SCRT balance before any
 * message runs, and spending that too would sink the transaction.
 */
export function splitRefill(
  sscrt: bigint,
  scrt: bigint,
  feeFromBalance = 0n
): { fromSscrt: bigint; fromScrt: bigint; short: bigint } {
  const fromSscrt = sscrt < CREDIT_FLOOR ? sscrt : CREDIT_FLOOR
  const spare = scrt > feeFromBalance ? scrt - feeFromBalance : 0n
  const left = CREDIT_FLOOR - fromSscrt
  const fromScrt = spare < left ? spare : left
  return { fromSscrt, fromScrt, short: left - fromScrt }
}

function noticeNoSscrt(): void {
  if (Date.now() - noticedAt < NOTICE_EVERY_MS) return
  noticedAt = Date.now()
  useNotifications.getState().push({
    kind: 'gas-empty',
    message:
      'Your gas credits are below 5 and there is nothing to refill them with — no SCRT, no sSCRT, and no token to swap for it. You can get SCRT/sSCRT on Shade Swap.'
  })
}

interface SwapPlan {
  message: Msg
  route: Route
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
 * it cannot, its whole balance goes, and the refill is smaller. Slippage
 * follows the trade's price impact (`slippageFor`).
 */
async function planSwap(address: string, permit: Permit, need: bigint): Promise<SwapPlan | undefined> {
  const { queryClient } = useWallet.getState()
  if (!queryClient || need <= 0n) return undefined

  const pairs = await listPairs(queryClient)
  const routable = (await swappableTokens(queryClient, permit)).map((token) => ({
    token,
    routes: findRoutes(pairs, token, SSCRT_ADDRESS)
  }))
  if (routable.length === 0) return undefined

  // Every balance in one request, and every pool on every route in another.
  const [balances, reserves] = await Promise.all([
    balancesOf(
      queryClient,
      permit,
      address,
      routable.map((candidate) => candidate.token)
    ),
    reservesFor(queryClient, pairsOf(routable.flatMap((candidate) => candidate.routes)))
  ])

  // What each whole holding would fetch, by its best route.
  const valued: Array<{ balance: bigint; best: Quote; routes: Route[] }> = []
  for (const candidate of routable) {
    const balance = balances.get(candidate.token) ?? 0n
    if (balance <= 0n) continue
    const best = candidate.routes
      .map((route) => quoteIn(route, reserves, balance))
      .filter((quote): quote is Quote => quote !== undefined)
      .sort((a, b) => (a.amountOut === b.amountOut ? 0 : a.amountOut > b.amountOut ? -1 : 1))[0]
    if (best && best.amountOut > 0n) valued.push({ balance, best, routes: candidate.routes })
  }
  valued.sort((a, b) =>
    a.best.amountOut === b.best.amountOut ? 0 : a.best.amountOut > b.best.amountOut ? -1 : 1
  )

  for (const { balance, best, routes } of valued) {
    // Enough to cover `need` with room for slippage: pay only for that.
    const exact = await bestExactOutAnywhere(queryClient, routes, reserves, need, (route) =>
      BigInt(estimateFee(purchaseGas(route), GAS_PRICE_USCRT))
    )

    if (exact && exact.amountIn <= balance) {
      return {
        message: await swapMessage(queryClient, address, exact.route, exact.amountIn, need),
        route: exact.route,
        minOut: need
      }
    }

    // Not enough of it, so all of it.
    const minOut = (best.amountOut * (10_000n - slippageFor(best.impactBps))) / 10_000n
    if (minOut < MIN_SWAP_OUT) continue
    return {
      message: await swapMessage(queryClient, address, best.route, best.amountIn, minOut),
      route: best.route,
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
export async function refillFor(
  address: string,
  bundle: { gasLimit: number; msgTypes: string[] }
): Promise<Refill | undefined> {
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

  // sSCRT is private, so its balance needs the permit. Without one, only the
  // public SCRT can pay: neither sSCRT nor anything to swap can be seen.
  const permit = loadPermit(address)
  let sscrt = 0n
  if (permit) {
    const balance = await queryBalance(queryClient, permitAuth(permit), SSCRT_ADDRESS)
    if (balance.status !== 'ok') return undefined
    sscrt = BigInt(balance.amount)
  }
  const scrt = BigInt(await queryNativeBalance(queryClient, address))

  // Who will pay this transaction's fee, judged on the largest it can get.
  const largest = bundle.gasLimit + REFILL_GAS + MAX_SWAP_GAS
  const walletPays = !useFeePayer.getState().granterFor(largest, [...bundle.msgTypes, MSG_EXECUTE_CONTRACT])
  const feeFromBalance = walletPays ? BigInt(estimateFee(largest, GAS_PRICE_USCRT)) : 0n

  const { fromSscrt, fromScrt, short } = splitRefill(sscrt, scrt, feeFromBalance)

  // Still short: buy the rest by swapping something else, in this same
  // transaction. The unwrap then covers the sSCRT held plus what the swap is
  // guaranteed to return.
  const swap =
    short > 0n && permit ? await planSwap(address, permit, short).catch(() => undefined) : undefined
  const unwrap = fromSscrt + (swap?.minOut ?? 0n)
  const amount = unwrap + fromScrt

  if (amount === 0n) {
    noticeNoSscrt()
    return undefined
  }

  return {
    amount,
    // A swap always comes with an unwrap, of what it returns.
    gas: unwrap > 0n ? purchaseGas(swap?.route) : GAS.buyGasCredit,
    messages: await purchaseMessages(queryClient, address, { unwrap, total: amount }, swap?.message)
  }
}

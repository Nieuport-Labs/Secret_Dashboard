import { DECIMALS, DISPLAY_DENOM } from '@/chains/secret4'
import { GAS_SLICE_MIN_RATIO } from '@/chains/osmosis'
import { fromBaseUnits, toBaseUnits } from '@/lib/format'

/**
 * "Get gas" — turning a slice of what you bridge into the ability to transact.
 *
 * The problem it solves is narrow and absolute: someone arriving on Secret with
 * no SCRT cannot sign anything, including the transaction that would get them
 * SCRT. Buying gas credits is a contract execution, and that needs gas. So the
 * swap has to happen *in flight*, carried by the IBC packet, with no Secret-side
 * signature from the user at any point.
 *
 * The route is source chain → Osmosis (swap to SCRT) → Secret. It rides as a
 * second `MsgTransfer` in the same source-chain transaction as the main bridge,
 * not as a split of one packet: Osmosis cannot swap part of a transfer, and
 * keeping them separate means a failure on the gas leg cannot take the main
 * amount with it.
 *
 * What this file owns is *sizing* the slice — how much of the bridged token to
 * take, and whether that is a reasonable thing to do at all. The swap itself,
 * and the message that carries it, come from Skip's routing API; see
 * `lib/skipGo.ts` for why a hand-composed memo against Osmosis's own
 * `crosschain-swaps` contract turned out not to work for almost anything that
 * isn't OSMO itself.
 */

export interface GasSliceQuote {
  /** SCRT to buy, in base units. */
  amountBaseUnits: string
  /** The same, for display. */
  amountScrt: string
  /** What it costs in the bridged token, in that token's base units. */
  costBaseUnits: string
  /** Roughly what it is worth, when a price was available. */
  usd?: number
}

export interface SliceInputs {
  /** Target value of the slice, in USD. */
  targetUsd: number
  /** Price of SCRT, in USD. Absent means no price and no slice can be sized. */
  scrtPrice?: number
  /** Price of the token being bridged, in USD. */
  tokenPrice?: number
  tokenDecimals: number
  /** What the user is bridging, in the token's base units. */
  bridgeAmountBaseUnits: string
}

/**
 * Size the slice, or explain why there is none.
 *
 * Returns `undefined` rather than guessing when either price is missing. A
 * fabricated slice would take a real amount of somebody's money.
 */
export function quoteGasSlice({
  targetUsd,
  scrtPrice,
  tokenPrice,
  tokenDecimals,
  bridgeAmountBaseUnits
}: SliceInputs): GasSliceQuote | undefined {
  if (!scrtPrice || !tokenPrice || scrtPrice <= 0 || tokenPrice <= 0) return undefined

  const scrtAmount = targetUsd / scrtPrice
  const tokenAmount = targetUsd / tokenPrice

  let amountBaseUnits: string
  let costBaseUnits: string
  try {
    amountBaseUnits = toBaseUnits(scrtAmount.toFixed(DECIMALS), DECIMALS)
    costBaseUnits = toBaseUnits(tokenAmount.toFixed(tokenDecimals), tokenDecimals)
  } catch {
    return undefined
  }

  if (BigInt(costBaseUnits) <= 0n) return undefined
  // Never take more than the user is actually bridging.
  if (BigInt(costBaseUnits) >= BigInt(bridgeAmountBaseUnits)) return undefined

  return {
    amountBaseUnits,
    amountScrt: fromBaseUnits(amountBaseUnits, DECIMALS),
    costBaseUnits,
    usd: targetUsd
  }
}

export type GasOffer =
  | { offer: false; reason: 'no-price' | 'amount-too-small' }
  | {
      offer: true
      /** Pre-checked, and worth emphasising: with no SCRT nothing else works. */
      urgent: boolean
      quote: GasSliceQuote
    }

/**
 * Whether to offer the gas slice, and how loudly.
 *
 * Offered whenever a slice can be sized and isn't an unreasonable bite out of
 * the transfer — a comfortable balance is not a reason to withhold the option,
 * only a reason not to reach for it unasked. That distinction lives entirely
 * in `urgent`: at exactly zero SCRT this is the difference between a wallet
 * that works and one that only looks at things, so it is pre-checked and said
 * plainly. Above zero it is offered unchecked, same as any other option on the
 * form — someone topping up before a bigger transaction has as much reason to
 * use it as someone arriving with nothing.
 */
export function shouldOfferGas(
  nativeBalanceBaseUnits: string | undefined,
  quote: GasSliceQuote | undefined,
  bridgeAmountBaseUnits: string
): GasOffer {
  if (!quote) return { offer: false, reason: 'no-price' }

  // Taking a dollar out of three bridged dollars is not a service, however
  // much SCRT is already sitting in the wallet.
  const bridged = BigInt(bridgeAmountBaseUnits)
  const cost = BigInt(quote.costBaseUnits)
  if (bridged < cost * BigInt(GAS_SLICE_MIN_RATIO)) {
    return { offer: false, reason: 'amount-too-small' }
  }

  const balance = BigInt(nativeBalanceBaseUnits ?? '0')
  return { offer: true, urgent: balance === 0n, quote }
}

/**
 * The largest slice size, at or below `currentTargetUsd`, that would actually
 * clear the minimum-ratio check for this transfer.
 *
 * Halves the target until `shouldOfferGas` would accept it, rather than
 * solving the ratio algebraically: the check runs on amounts that have already
 * been through `toBaseUnits`' rounding, and re-deriving a target through that
 * same rounding in reverse is more code than just asking the real function.
 * Balance is passed as zero on purpose — this answers "would the ratio pass",
 * not "does this wallet also have enough SCRT already", which is a separate
 * question the caller has already answered by getting here at all.
 */
export function fittingGasSliceUsd(
  currentTargetUsd: number,
  scrtPrice: number | undefined,
  tokenPrice: number | undefined,
  tokenDecimals: number,
  bridgeAmountBaseUnits: string
): number {
  let target = currentTargetUsd
  for (let i = 0; i < 12 && target > 0.02; i++) {
    target /= 2
    const quote = quoteGasSlice({
      targetUsd: target,
      scrtPrice,
      tokenPrice,
      tokenDecimals,
      bridgeAmountBaseUnits
    })
    if (shouldOfferGas('0', quote, bridgeAmountBaseUnits).offer) {
      return Math.round(target * 100) / 100
    }
  }
  // Nothing found down to the floor — the transfer is too small for any slice
  // worth taking. Return the floor itself; the caller still shows "too small"
  // afterward; the button just stops help offering a number that cannot work.
  return 0.02
}

/** Plain-language summary of what the slice buys, for the confirmation line. */
export function describeGasSlice(quote: GasSliceQuote, tokenSymbol: string, tokenAmount: string): string {
  return `${quote.amountScrt} ${DISPLAY_DENOM} (about $${quote.usd?.toFixed(2)}) taken from ${tokenAmount} ${tokenSymbol}`
}

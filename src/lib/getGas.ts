import { DECIMALS, DISPLAY_DENOM } from '@/chains/secret4'
import { GAS_SLICE_MIN_RATIO, LOW_BALANCE_THRESHOLD_SCRT } from '@/chains/osmosis'
import { fromBaseUnits, toBaseUnits } from '@/lib/format'
import { gasCreditMemo, osmosisSwapToSecretMemo, type HookedTransfer } from '@/lib/ibcMemo'

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
 */

/** What lands on Secret at the end of the gas leg. */
export type GasDelivery =
  /**
   * Native SCRT in the user's own wallet. Depends on nothing but the swap, and
   * the user can spend it on anything, including gas. The default.
   */
  | 'native'
  /**
   * A fee allowance issued by the gas vault, via an IBC hook.
   *
   * Verified as far as it can be without sending a real packet: the vault
   * ignores `info.sender`, which the hook nulls, and `next_memo` is the slot
   * that reaches Secret. What is *not* verified is how Secret's hook treats the
   * `ibc_callback` key Osmosis adds to that same memo. Until a live packet
   * settles that, this is opt-in.
   */
  | 'credits'

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
  | { offer: false; reason: 'has-enough' | 'no-price' | 'amount-too-small' }
  | {
      offer: true
      /** Pre-checked, and worth emphasising: with no SCRT nothing else works. */
      urgent: boolean
      quote: GasSliceQuote
    }

/**
 * Whether to offer the gas slice, and how loudly.
 *
 * Below one SCRT it is a suggestion. At exactly zero it is the difference
 * between a wallet that works and one that only looks at things, so it is
 * pre-checked and said plainly.
 */
export function shouldOfferGas(
  nativeBalanceBaseUnits: string | undefined,
  quote: GasSliceQuote | undefined,
  bridgeAmountBaseUnits: string
): GasOffer {
  const balance = BigInt(nativeBalanceBaseUnits ?? '0')
  const threshold = BigInt(toBaseUnits(String(LOW_BALANCE_THRESHOLD_SCRT), DECIMALS))

  if (balance >= threshold) return { offer: false, reason: 'has-enough' }
  if (!quote) return { offer: false, reason: 'no-price' }

  // Taking a dollar out of three bridged dollars is not a service.
  const bridged = BigInt(bridgeAmountBaseUnits)
  const cost = BigInt(quote.costBaseUnits)
  if (bridged < cost * BigInt(GAS_SLICE_MIN_RATIO)) {
    return { offer: false, reason: 'amount-too-small' }
  }

  return { offer: true, urgent: balance === 0n, quote }
}

export interface GasLegOptions {
  /** The user's Secret address. */
  secretAddress: string
  /** The user's own Osmosis address, derived from the same key. */
  osmosisAddress: string
  delivery: GasDelivery
  slippagePercent?: number
}

/**
 * The receiver and memo for the gas leg's `MsgTransfer`, sent to Osmosis.
 *
 * For `native` the swap output goes straight to the user and no hook runs on
 * Secret at all. For `credits` the output is addressed to the vault, with the
 * user's address inside the message — because Secret's hook requires the
 * receiver and the hooked contract to be the same address.
 */
export function buildGasLeg({
  secretAddress,
  osmosisAddress,
  delivery,
  slippagePercent
}: GasLegOptions): HookedTransfer {
  if (delivery === 'native') {
    return osmosisSwapToSecretMemo({
      secretReceiver: secretAddress,
      recoveryAddress: osmosisAddress,
      slippagePercent
    })
  }

  const hook = gasCreditMemo(secretAddress)
  return osmosisSwapToSecretMemo({
    secretReceiver: hook.receiver,
    recoveryAddress: osmosisAddress,
    secretMemo: hook.memo,
    slippagePercent
  })
}

/** Plain-language summary of what the slice buys, for the confirmation line. */
export function describeGasSlice(quote: GasSliceQuote, tokenSymbol: string, tokenAmount: string): string {
  return `${quote.amountScrt} ${DISPLAY_DENOM} (about $${quote.usd?.toFixed(2)}) taken from ${tokenAmount} ${tokenSymbol}`
}

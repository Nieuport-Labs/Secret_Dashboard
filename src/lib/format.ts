/**
 * Money handling. Amounts are strings and `BigInt` end to end — nothing here
 * routes a balance through a float, because 0.1 + 0.2 is a rounding error that
 * becomes someone's missing tokens.
 *
 * "Base units" means the chain's smallest denomination (uscrt); "display" means
 * what a person reads (SCRT).
 */

import { DECIMALS, DISPLAY_DENOM } from '@/chains/secret4'

/**
 * Parse a human-typed decimal into base units, without ever making a Number of
 * it. Throws on anything that is not a plain non-negative decimal, so a bad
 * value fails at the input rather than silently becoming NaN in a transaction.
 */
export function toBaseUnits(value: string, decimals = DECIMALS): string {
  const trimmed = value.trim().replace(/,/g, '')
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === '' || trimmed === '.') {
    throw new Error(`"${value}" is not a number`)
  }

  const [whole = '0', fraction = ''] = trimmed.split('.')
  if (fraction.length > decimals) {
    throw new Error(`More than ${decimals} decimal places: "${value}"`)
  }

  return (
    BigInt(whole || '0') * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, '0') || '0')
  ).toString()
}

/** Base units to a plain decimal string. No thousands separators, no rounding. */
export function fromBaseUnits(value: string | bigint, decimals = DECIMALS): string {
  const amount = typeof value === 'bigint' ? value : BigInt(value || '0')
  const negative = amount < 0n
  const digits = (negative ? -amount : amount).toString().padStart(decimals + 1, '0')

  const whole = digits.slice(0, digits.length - decimals)
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, '')

  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`
}

/**
 * Base units formatted for reading: grouped thousands, and at most
 * `maxFractionDigits` decimals.
 *
 * Truncates rather than rounds. Showing 1.0000 for a balance of 0.99999 invites
 * someone to try sending 1.0000 and be told they cannot afford it.
 */
export function formatAmount(
  value: string | bigint,
  { decimals = DECIMALS, maxFractionDigits = 6 }: { decimals?: number; maxFractionDigits?: number } = {}
): string {
  const plain = fromBaseUnits(value, decimals)
  const [whole, fraction = ''] = plain.split('.')

  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  const shown = fraction.slice(0, maxFractionDigits).replace(/0+$/, '')

  return shown ? `${grouped}.${shown}` : grouped
}

/** `formatAmount` with the ticker appended. */
export function formatWithDenom(
  value: string | bigint,
  denom: string = DISPLAY_DENOM,
  options?: { decimals?: number; maxFractionDigits?: number }
): string {
  return `${formatAmount(value, options)} ${denom}`
}

/**
 * Fee in base units for a gas limit, rounded up.
 *
 * Rounding up matters: the fee actually charged is ceil(gas × price), and an
 * estimate a single unit short makes a fee grant look able to cover a
 * transaction that then fails.
 */
export function estimateFee(gasLimit: number, gasPrice: number): string {
  return Math.ceil(gasLimit * gasPrice).toString()
}

/** `secret1abc…xyz` — the form the design uses in chips and lists. */
export function shortenAddress(address: string, lead = 9, tail = 4): string {
  if (address.length <= lead + tail + 1) return address
  return `${address.slice(0, lead)}…${address.slice(-tail)}`
}

/**
 * A fiat figure from a base-unit amount and a unit price.
 *
 * This is the one place a float is acceptable: the price is already a float
 * from an API, and the result is decoration, never an input to a transaction.
 * `undefined` price yields `undefined`, so callers show "no price" rather than
 * a fabricated zero.
 */
export function fiatValue(
  value: string | bigint,
  unitPrice: number | undefined,
  decimals = DECIMALS
): number | undefined {
  if (unitPrice === undefined) return undefined
  return Number(fromBaseUnits(value, decimals)) * unitPrice
}

export function formatFiat(amount: number | undefined, currency = 'USD'): string {
  if (amount === undefined) return 'No price'
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: amount < 1 ? 4 : 2
  }).format(amount)
}

/**
 * An amount sized for reading rather than for exactness.
 *
 * `formatAmount` shows every place it has, which is right in a form where the
 * figure is about to be sent and wrong everywhere else: `543.656931 SCRT` in a
 * summary is six digits of precision nobody asked for, and it makes a balance
 * look like a serial number.
 *
 * Precision follows magnitude, the way a person would read it aloud. Small
 * amounts keep their detail, because for a token worth a fraction of a cent the
 * detail is the whole figure.
 */
export function formatDisplayAmount(value: string | bigint, decimals = DECIMALS): string {
  const exact = Number(fromBaseUnits(value, decimals))

  if (exact === 0) return '0'
  if (exact >= 1_000_000) return formatAmount(value, { decimals, maxFractionDigits: 0 })
  if (exact >= 1000) return formatAmount(value, { decimals, maxFractionDigits: 1 })
  if (exact >= 1) return formatAmount(value, { decimals, maxFractionDigits: 2 })
  if (exact >= 0.01) return formatAmount(value, { decimals, maxFractionDigits: 4 })
  return formatAmount(value, { decimals, maxFractionDigits: 6 })
}

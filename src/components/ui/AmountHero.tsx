import { ArrowUpDown } from 'lucide-react'
import { useEffect, useState } from 'react'

import { cn } from '@/lib/cn'
import { formatAmount, formatFiat, toBaseUnits } from '@/lib/format'

interface Props {
  /** Whole units of the token, as typed. The one source of truth. */
  amount: string
  onAmount: (value: string) => void
  symbol: string
  decimals: number
  /** One whole unit's price in `currency`; without it there is no fiat view. */
  unitPrice?: number
  currency: string
}

/** The currency's own sign — `$`, `€`, `Kč` — for the prefix in front of the figure. */
function currencySign(currency: string): string {
  try {
    return (
      new Intl.NumberFormat(undefined, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' })
        .formatToParts(0)
        .find((part) => part.type === 'currency')?.value ?? currency
    )
  } catch {
    return currency
  }
}

/** Base units for display, or zero for a figure that does not parse yet. */
function toBaseUnitsSafe(value: string, decimals: number): string {
  try {
    return toBaseUnits(value, decimals)
  } catch {
    return '0'
  }
}

/** A fiat figure turned back into a token amount, cut to the token's own places. */
function tokenFromFiat(fiat: string, unitPrice: number, decimals: number): string {
  const value = Number(fiat)
  if (!fiat || !Number.isFinite(value) || value <= 0) return ''
  return (value / unitPrice).toFixed(decimals).replace(/\.?0+$/, '')
}

function fiatOf(amount: string, unitPrice: number | undefined): number | undefined {
  if (unitPrice === undefined || !amount || !Number.isFinite(Number(amount))) return undefined
  return Number(amount) * unitPrice
}

/**
 * The amount, first and largest, with Uniswap's switch between the token and
 * money.
 *
 * Shared by Send and the invoice form, which ask the same question from the
 * two sides of a payment. The token amount stays the caller's and the only
 * figure that matters — it is what gets sent or asked for. The fiat text is
 * kept here only so that typing "12." is not rewritten to "12" under the
 * cursor; whenever the amount changes from outside (a slider, a new asset) the
 * fiat text is rebuilt from it.
 */
export default function AmountHero({ amount, onAmount, symbol, decimals, unitPrice, currency }: Props) {
  const [inFiat, setInFiat] = useState(false)
  const [fiatText, setFiatText] = useState('')
  const fiatMode = inFiat && unitPrice !== undefined

  // Follow the amount when it was not typed here in fiat.
  useEffect(() => {
    if (unitPrice === undefined) return
    if (tokenFromFiat(fiatText, unitPrice, decimals) === amount) return
    const fiat = fiatOf(amount, unitPrice)
    setFiatText(fiat === undefined ? '' : fiat.toFixed(2))
    // `fiatText` is left out on purpose: typing it must not trigger a rewrite.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, unitPrice, decimals])

  const typeFiat = (value: string) => {
    setFiatText(value)
    if (unitPrice !== undefined) onAmount(tokenFromFiat(value, unitPrice, decimals))
  }

  const shown = fiatMode ? fiatText : amount

  return (
    <div className="flex flex-col items-center gap-2 py-3">
      <div className="flex max-w-full items-baseline justify-center text-[2.75rem] font-medium leading-tight tabular-nums">
        {fiatMode ? (
          <span className={cn('shrink-0', !fiatText && 'text-text-faint')}>{currencySign(currency)}</span>
        ) : null}
        <input
          data-autofocus
          inputMode="decimal"
          value={shown}
          onChange={(event) => (fiatMode ? typeFiat(event.target.value) : onAmount(event.target.value))}
          placeholder="0"
          aria-label={fiatMode ? `Amount in ${currency}` : `Amount of ${symbol}`}
          // Sized to what is typed, so the sign sits against the figure and
          // the pair stays centred as one.
          style={{ width: `${Math.max(1, shown.length) + 0.5}ch` }}
          className="min-w-0 max-w-full bg-transparent text-center outline-none placeholder:text-text-faint"
        />
      </div>

      {/*
        The other unit, and the switch between them. Offered only when the
        asset has a price — otherwise there is nothing to switch to.
      */}
      {unitPrice !== undefined ? (
        <button
          type="button"
          onClick={() => setInFiat((current) => !current)}
          aria-label={fiatMode ? `Enter the amount in ${symbol}` : `Enter the amount in ${currency}`}
          className="state-layer flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-base text-text-muted"
        >
          {fiatMode
            ? `${amount ? formatAmount(toBaseUnitsSafe(amount, decimals), { decimals }) : '0'} ${symbol}`
            : formatFiat(fiatOf(amount, unitPrice) ?? 0, currency)}
          <ArrowUpDown size={14} aria-hidden />
        </button>
      ) : (
        <span className="text-base text-text-muted">{symbol}</span>
      )}
    </div>
  )
}

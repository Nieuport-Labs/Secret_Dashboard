import { ChevronDown } from 'lucide-react'
import { useState } from 'react'

import { PickerDialog, type PickerOption } from '@/components/ui/Picker'
import { cn } from '@/lib/cn'
import { formatAmount, fromBaseUnits, toBaseUnits } from '@/lib/format'

interface Props {
  amount: string
  onAmount: (value: string) => void
  /** Ticker shown beside the figure and on the balance line. */
  symbol?: string
  image?: string
  /** Base units the account holds. Undefined means "not read yet", not zero. */
  available?: string
  decimals: number
  error?: string
  label?: string
  /**
   * Choices for the trigger beside the figure. Omitted where the asset is not
   * the user's to pick — an unwrap has exactly one thing it can return.
   */
  options?: PickerOption[]
  optionsLabel?: string
  value?: string
  onSelect?: (id: string) => void
}

const PERCENTS = [25, 50, 100] as const

/**
 * An amount, the balance behind it, and the two ways of spending a fraction of
 * that balance.
 *
 * The asset is chosen by clicking the asset, in the slot where the ticker has
 * to be printed anyway — so choosing costs no extra row, and every form using
 * this reads the same way.
 */
export default function AmountField({
  amount,
  onAmount,
  symbol,
  image,
  available,
  decimals,
  error,
  label = 'Amount',
  options,
  optionsLabel = 'Token',
  value,
  onSelect
}: Props) {
  const [picking, setPicking] = useState(false)

  const has = available !== undefined && BigInt(available) > 0n
  const base = (() => {
    try {
      return amount ? BigInt(toBaseUnits(amount, decimals)) : 0n
    } catch {
      return 0n
    }
  })()

  const percent = has && !error ? Number((base * 100n) / BigInt(available)) : 0

  const setPercent = (share: number) => {
    if (available === undefined) return
    const next = (BigInt(available) * BigInt(share)) / 100n
    onAmount(fromBaseUnits(next.toString(), decimals))
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-label text-text-muted">{label}</span>
        {available !== undefined ? (
          <span className="text-label tabular-nums text-text-faint">
            Balance {formatAmount(available, { decimals })} {symbol}
          </span>
        ) : null}
      </div>

      <div className="flex items-center gap-2 rounded-control border border-border bg-surface p-2 pl-3">
        <input
          inputMode="decimal"
          value={amount}
          onChange={(event) => onAmount(event.target.value)}
          placeholder="0.0"
          aria-label={label}
          className="min-w-0 flex-1 bg-transparent text-headline tabular-nums outline-none placeholder:text-text-faint"
        />

        {options && onSelect ? (
          <button
            type="button"
            disabled={options.length === 0}
            onClick={() => setPicking(true)}
            aria-haspopup="dialog"
            className={cn(
              'state-layer flex shrink-0 items-center gap-2 rounded-pill border border-border py-1.5 pl-1.5 pr-2.5',
              'disabled:cursor-not-allowed disabled:opacity-50'
            )}
          >
            {image ? <img src={image} alt="" className="size-6 shrink-0 rounded-pill" /> : null}
            <span className="text-base font-medium">{symbol ?? optionsLabel}</span>
            <ChevronDown size={14} aria-hidden className="text-text-muted" />
          </button>
        ) : (
          <span className="flex shrink-0 items-center gap-2 py-1.5 pr-2.5">
            {image ? <img src={image} alt="" className="size-6 shrink-0 rounded-pill" /> : null}
            <span className="text-base font-medium text-text-muted">{symbol}</span>
          </span>
        )}
      </div>

      {options && onSelect ? (
        <PickerDialog
          open={picking}
          onClose={() => setPicking(false)}
          label={optionsLabel}
          options={options}
          value={value}
          onChange={onSelect}
        />
      ) : null}

      {/*
        The slider and the buttons drive the same number and both earn their
        place: the buttons are exact and one tap, the slider is for the case
        where the fraction is a judgement rather than a round figure.
      */}
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.min(100, Math.max(0, percent))}
          disabled={!has}
          onChange={(event) => setPercent(Number(event.target.value))}
          aria-label="Fraction of balance"
          className="slider min-w-0 flex-1"
        />
        <div className="flex shrink-0 gap-1">
          {PERCENTS.map((share) => (
            <button
              key={share}
              type="button"
              disabled={!has}
              onClick={() => setPercent(share)}
              className={cn(
                'state-layer rounded-pill border border-border px-2.5 py-1 text-label font-medium',
                'disabled:cursor-not-allowed disabled:opacity-40',
                percent === share ? 'bg-accent-container text-accent' : 'text-text-muted'
              )}
            >
              {share === 100 ? 'Max' : `${share}%`}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <span className="text-base text-negative" role="alert">
          {error}
        </span>
      ) : null}
    </section>
  )
}

import { ChevronDown } from 'lucide-react'
import { useState } from 'react'

import { PickerDialog, type PickerOption } from '@/components/ui/Picker'
import ShareSlider from '@/components/ui/ShareSlider'
import { cn } from '@/lib/cn'
import { formatAmount } from '@/lib/format'

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

/**
 * An amount, the balance behind it, and the two ways of spending a fraction of
 * that balance (`ShareSlider`).
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

      <ShareSlider
        amount={amount}
        onAmount={onAmount}
        available={available}
        decimals={decimals}
        invalid={Boolean(error)}
      />

      {error ? (
        <span className="text-base text-negative" role="alert">
          {error}
        </span>
      ) : null}
    </section>
  )
}

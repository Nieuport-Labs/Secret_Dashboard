import { cn } from '@/lib/cn'
import { fromBaseUnits, toBaseUnits } from '@/lib/format'

interface Props {
  amount: string
  onAmount: (value: string) => void
  /** Base units the account holds. Undefined means "not read yet", not zero. */
  available?: string
  decimals: number
  /** The typed amount is not a number, or is more than is held. */
  invalid?: boolean
}

const PERCENTS = [25, 50, 100] as const

/**
 * The two ways of spending a fraction of a balance: a slider and three buttons.
 *
 * Both drive the same number and both earn their place: the buttons are exact
 * and one tap, the slider is for the case where the fraction is a judgement
 * rather than a round figure. Shared so that every amount in the app — the
 * plain field, Send and Wrap — offers the same two.
 */
export default function ShareSlider({ amount, onAmount, available, decimals, invalid = false }: Props) {
  const has = available !== undefined && BigInt(available) > 0n

  const base = (() => {
    try {
      return amount ? BigInt(toBaseUnits(amount, decimals)) : 0n
    } catch {
      return 0n
    }
  })()

  const percent = has && !invalid ? Number((base * 100n) / BigInt(available)) : 0

  const setPercent = (share: number) => {
    if (available === undefined) return
    const next = (BigInt(available) * BigInt(share)) / 100n
    onAmount(fromBaseUnits(next.toString(), decimals))
  }

  return (
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
  )
}

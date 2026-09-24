import { cn } from '@/lib/cn'

interface Props {
  amount: string
  symbol: string
  image?: string
  /** `lg` for the headline of a page, `md` inside a dialog. */
  size?: 'md' | 'lg'
  className?: string
}

/**
 * An amount with its token beside it — `150 (logo) sSCRT` — on one line.
 *
 * One line rather than the figure over a caption: the two are read together
 * as one phrase, and splitting them over two lines spent a whole row on a
 * ticker. The token is set smaller than the figure and on its baseline, so the
 * number still leads.
 */
export default function AssetAmount({ amount, symbol, image, size = 'lg', className }: Props) {
  return (
    <span className={cn('inline-flex max-w-full flex-wrap items-baseline gap-x-3 gap-y-1', className)}>
      <span
        className={cn(
          'font-medium leading-none tabular-nums',
          size === 'lg' ? 'text-[2.75rem]' : 'text-[2rem]'
        )}
      >
        {amount}
      </span>
      <span
        className={cn(
          'inline-flex items-center gap-2 self-center font-medium text-text-muted',
          size === 'lg' ? 'text-headline' : 'text-title'
        )}
      >
        {image ? (
          <img
            src={image}
            alt=""
            className={cn('shrink-0 rounded-pill', size === 'lg' ? 'size-8' : 'size-6')}
          />
        ) : null}
        {symbol}
      </span>
    </span>
  )
}

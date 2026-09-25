import { cn } from '@/lib/cn'

interface Props {
  amount: string
  symbol: string
  image?: string
  /** `lg` for the headline of a page, `md` inside a dialog. */
  size?: 'md' | 'lg'
  /**
   * `stacked` puts the token under the figure, both centred — for a card
   * whose whole job is the amount, where a long figure would otherwise push
   * the token onto a line of its own, flush left.
   */
  layout?: 'inline' | 'stacked'
  className?: string
}

/**
 * An amount with its token beside it — `150 (logo) sSCRT` — on one line.
 *
 * One line rather than the figure over a caption: the two are read together
 * as one phrase, and splitting them over two lines spent a whole row on a
 * ticker. The token is set smaller than the figure and on its baseline, so the
 * number still leads.
 *
 * Should it wrap anyway, the token stays centred under the figure rather than
 * being left behind at the start of the line.
 */
/**
 * The figure's size. A long amount — six decimal places of SCRT — is set
 * smaller rather than broken across lines: a number split in the middle
 * reads as two numbers.
 */
function figureSize(amount: string, size: 'md' | 'lg'): string {
  if (size === 'md') return amount.length > 11 ? 'text-[1.625rem]' : 'text-[2rem]'
  return amount.length > 11 ? 'text-[2rem]' : amount.length > 8 ? 'text-[2.25rem]' : 'text-[2.75rem]'
}

export default function AssetAmount({
  amount,
  symbol,
  image,
  size = 'lg',
  layout = 'inline',
  className
}: Props) {
  const stacked = layout === 'stacked'
  return (
    <span
      className={cn(
        'inline-flex max-w-full justify-center gap-x-3',
        stacked ? 'flex-col items-center gap-y-2' : 'flex-wrap items-baseline gap-y-1',
        className
      )}
    >
      <span
        className={cn('max-w-full break-all font-medium leading-none tabular-nums', figureSize(amount, size))}
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

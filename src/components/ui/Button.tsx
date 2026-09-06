import type { ButtonHTMLAttributes, ReactNode } from 'react'

import { cn } from '@/lib/cn'

export type ButtonVariant = 'primary' | 'secondary' | 'soft' | 'text' | 'ghost'
export type ButtonSize = 'sm' | 'md' | 'lg'
/**
 * The design uses two shapes with a rule, not at random: fully rounded for the
 * page's primary calls to action, and the control radius for the tonal action
 * buttons that sit inside a card.
 */
export type ButtonShape = 'pill' | 'control'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  shape?: ButtonShape
  /** Rendered on the left. Pass a Lucide icon with an explicit size. */
  icon?: ReactNode
  /** Rendered on the right, opposite `icon`. */
  trailing?: ReactNode
  /** Stretch to the container's width, as the welcome screen's buttons do. */
  block?: boolean
  /** Shows a spinner and blocks clicks. Distinct from `disabled`. */
  loading?: boolean
}

const VARIANTS: Record<ButtonVariant, string> = {
  /*
   * The design's call to action. The surface is --color-accent-strong rather
   * than --color-accent: the brand orange with a white label measures 3.59:1,
   * which is not enough for body-size text. See tokens.css.
   */
  primary: 'bg-accent-strong text-[var(--color-accent-text)]',
  // "Continue with Keplr" — a translucent wash over the page rather than a
  // solid grey, so it works on any background.
  secondary: 'bg-surface border-border text-text',
  // The wallet screen's Send / Receive / Wrap / Bridge row, and Stake.
  soft: 'bg-accent-container text-accent',
  /*
   * Material's text button. For an action repeated down a list, where a filled
   * one per row turns the page into a column of buttons and stops any of them
   * meaning anything.
   */
  text: 'bg-transparent text-accent',
  ghost: 'bg-transparent text-text-muted hover:text-text'
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'text-sm px-3 py-1.5 gap-1.5',
  md: 'text-base px-4 py-2 gap-2',
  lg: 'text-base p-2.5 gap-2.5'
}

export default function Button({
  variant = 'primary',
  size = 'md',
  shape = 'pill',
  icon,
  trailing,
  block = false,
  loading = false,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: Props) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center font-medium',
        // Every variant carries the border box whether or not it paints one, so
        // a bordered button and a filled one still line up when they sit side
        // by side.
        'border border-transparent',
        shape === 'pill' ? 'rounded-pill' : 'rounded-control',
        'transition-[transform,background-color] duration-[var(--duration-short)] ease-[var(--ease-standard)]',
        // A press should feel like it went in. Transform only, so it stays on
        // the compositor.
        'active:scale-[0.98]',
        'disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100',
        // Hover, focus and press come from one Material state layer; see index.css.
        'state-layer',
        VARIANTS[variant],
        SIZES[size],
        block ? 'w-full justify-center' : 'justify-center',
        className
      )}
      {...rest}
    >
      {block ? (
        /*
         * Two side cells of equal width, so the label is centred on the button
         * whatever either side holds — or holds nothing.
         *
         * This used to be `justify-between` with a fixed 24px spacer opposite
         * the icon. That miscentres twice over: a button with no icon at all
         * still got the spacer, pulling the label 12px left, and a button whose
         * icon was not 24px wide was off by the difference. `flex-1` gives both
         * cells a basis of zero and the same share of what is left, which is
         * exact by construction rather than by matching a number.
         */
        <>
          <span className="flex min-w-0 flex-1 items-center justify-start">
            {loading ? <Spinner /> : icon}
          </span>
          <span className="shrink-0">{children}</span>
          <span className="flex min-w-0 flex-1 items-center justify-end">{trailing}</span>
        </>
      ) : (
        <>
          {loading ? <Spinner /> : icon}
          <span>{children}</span>
          {trailing}
        </>
      )}
    </button>
  )
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="size-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  )
}

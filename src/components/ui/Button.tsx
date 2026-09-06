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
        // The welcome screen's buttons space icon, label and trailing slot apart
        // rather than clustering them; that only reads right at full width.
        block ? 'w-full justify-between' : 'justify-center',
        className
      )}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
      <span className={cn(block && 'flex-1 text-center')}>{children}</span>
      {/* Keeps the label optically centred when only one side carries an icon. */}
      {trailing ?? (block ? <span aria-hidden className="size-6" /> : null)}
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

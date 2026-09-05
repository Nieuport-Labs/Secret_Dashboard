import type { ButtonHTMLAttributes, ReactNode } from 'react'

import { cn } from '@/lib/cn'

export type ButtonVariant = 'primary' | 'secondary' | 'soft' | 'ghost'
export type ButtonSize = 'sm' | 'md' | 'lg'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
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
  // The design's call-to-action: solid accent, white label in both themes.
  primary: 'bg-accent text-[var(--color-accent-text)] hover:bg-accent-hover',
  // "Continue with Keplr" — a translucent wash over the page, not a solid grey,
  // so it works on any background.
  secondary: 'bg-surface text-text hover:bg-[rgb(255_255_255/0.16)]',
  // The wallet screen's Send / Receive / Wrap / Bridge row.
  soft: 'bg-accent-soft text-accent hover:bg-[rgb(255_57_18/0.18)]',
  ghost: 'bg-transparent text-text-muted hover:text-text hover:bg-surface'
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'text-sm px-4 py-2 gap-2',
  md: 'text-base px-5 py-2.5 gap-2.5',
  lg: 'text-base p-2.5 gap-2.5'
}

export default function Button({
  variant = 'primary',
  size = 'md',
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
        'inline-flex items-center rounded-pill font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        // The welcome screen's buttons space their icon, label and trailing slot
        // apart rather than clustering them; that only reads right full-width.
        block ? 'w-full justify-between' : 'justify-center',
        className
      )}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
      <span className={cn(block && 'flex-1 text-center')}>{children}</span>
      {/* Keeps the label optically centred when only one side has an icon. */}
      {trailing ?? (block ? <span aria-hidden className="size-[30px]" /> : null)}
    </button>
  )
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  )
}

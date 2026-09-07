import { useEffect, useRef, useState, type ReactNode } from 'react'

import { cn } from '@/lib/cn'

interface Props {
  /** The button that opens it. */
  trigger: ReactNode
  /** Describes the trigger for screen readers, since it is usually an icon. */
  label: string
  children: ReactNode
  /** Which edge the panel hangs from. Rows near the right margin want `right`. */
  align?: 'left' | 'right'
  triggerClassName?: string
  className?: string
}

/**
 * A menu that hangs off a button.
 *
 * Positioned absolutely against the trigger rather than portalled, which means
 * no ancestor between the two may clip its overflow — `state-layer` sets
 * `overflow: hidden`, so a row holding one of these cannot also be a state
 * layer. Worth knowing before wondering why a menu is missing its lower half.
 */
export default function Menu({
  trigger,
  label,
  children,
  align = 'right',
  triggerClassName,
  className
}: Props) {
  const [open, setOpen] = useState(false)
  const wrapper = useRef<HTMLDivElement>(null)

  // A menu that stays open when you click elsewhere feels stuck.
  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={wrapper} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={label}
        className={cn('state-layer', triggerClassName)}
      >
        {trigger}
      </button>

      {open ? (
        <div
          role="menu"
          // Any item click closes it: every item in these menus either performs
          // the action or navigates, and none of them is a toggle worth staying
          // open for.
          onClick={() => setOpen(false)}
          className={cn(
            'glass absolute top-[calc(100%+6px)] z-30 flex min-w-[190px] flex-col gap-0.5',
            'rounded-card border border-glass-edge p-1.5 shadow-menu',
            'motion-safe:animate-[modal-in_var(--duration-short)_var(--ease-emphasised)]',
            align === 'right' ? 'right-0' : 'left-0',
            className
          )}
        >
          {children}
        </div>
      ) : null}
    </div>
  )
}

interface ItemProps {
  icon?: ReactNode
  onClick: () => void
  children: ReactNode
  disabled?: boolean
  /** Explains a disabled state — a native tooltip is enough for something this minor. */
  title?: string
}

export function MenuItem({ icon, onClick, children, disabled, title }: ItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'state-layer flex items-center gap-2.5 whitespace-nowrap rounded-control px-3 py-2 text-left text-base',
        disabled && 'cursor-not-allowed opacity-50'
      )}
    >
      {icon}
      {children}
    </button>
  )
}

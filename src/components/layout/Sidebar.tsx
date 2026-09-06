import { NavLink } from 'react-router-dom'

import { cn } from '@/lib/cn'
import { NAV_ITEMS } from './navigation'

/**
 * The design's left rail: mark and wordmark at the top, then the six
 * destinations. Below `lg` it becomes a bottom bar, because a 322px rail on a
 * phone leaves nothing for the content it is navigating.
 */
export default function Sidebar() {
  return (
    <nav
      aria-label="Main"
      className={cn(
        // Bottom bar on small screens.
        'fixed inset-x-0 bottom-0 z-30 flex items-center justify-around border-t border-border bg-bg px-2 py-2',
        // Left rail from lg up.
        'lg:inset-y-0 lg:right-auto lg:w-[var(--sidebar-width)] lg:flex-col lg:items-stretch lg:justify-start',
        'lg:gap-[50px] lg:border-r lg:border-t-0 lg:px-[30px] lg:py-[50px]'
      )}
    >
      <NavLink
        to="/wallet"
        className="hidden items-start gap-2.5 rounded-control lg:flex"
        aria-label="Secret Dashboard, version 1.9"
      >
        <img src="/img/logo-mark.svg" alt="" className="h-[50px] w-[48px] shrink-0" />
        <span className="flex flex-col whitespace-nowrap">
          <span className="text-headline">Secret Dashboard</span>
          <span className="text-base text-text-faint">
            version <span className="text-text">1.9</span>
          </span>
        </span>
      </NavLink>

      {/* 182px is the design's nav column: the active pill is meant to be
          narrower than the rail, not to run its full width. */}
      <ul className="contents lg:flex lg:w-[182px] lg:flex-col lg:gap-[15px]">
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <li key={to} className="min-w-0 flex-1 lg:flex-none">
            <NavLink
              to={to}
              className={({ isActive }) =>
                cn(
                  'state-layer flex items-center gap-2.5 rounded-control',
                  'transition-colors duration-[var(--duration-short)] ease-[var(--ease-standard)]',
                  'flex-col px-1 py-2 text-[11px] lg:flex-row lg:px-[15px] lg:py-2.5 lg:text-xl',
                  isActive
                    ? 'bg-accent-soft font-medium text-accent'
                    : 'font-medium text-text-muted hover:text-text'
                )
              }
            >
              {/* Lucide, with an explicit size at every use — the icon must not
                  inherit a font size that happens to be nearby. */}
              <Icon size={16} strokeWidth={2} aria-hidden className="shrink-0" />
              <span className="truncate">{label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}

import { NavLink } from 'react-router-dom'

import { cn } from '@/lib/cn'
import { NAV_ITEMS } from './navigation'

/**
 * The design's left rail: mark and wordmark at the top, then the six
 * destinations. Below `lg` it becomes a bottom bar, because a rail on a phone
 * leaves nothing for the content it is navigating.
 *
 * Both forms are glass. The rail sits over the page rather than beside it, so
 * content scrolling underneath stays faintly visible through it — which is what
 * tells you the rail is a fixed layer and not a second column.
 */
export default function Sidebar() {
  return (
    <nav
      aria-label="Main"
      className={cn(
        'glass',
        // Bottom bar on small screens.
        'fixed inset-x-0 bottom-0 z-30 flex items-center justify-around border-t border-border px-2 py-1.5',
        // Left rail from lg up.
        'lg:inset-y-0 lg:right-auto lg:w-[var(--sidebar-width)] lg:flex-col lg:items-stretch lg:justify-start',
        'lg:gap-9 lg:border-r lg:border-t-0 lg:px-4 lg:py-7'
      )}
    >
      <NavLink
        to="/wallet"
        className="hidden items-center gap-2.5 rounded-control px-2 lg:flex"
        aria-label="Secret Dashboard, version 1.9"
      >
        <img src="/img/logo-mark.svg" alt="" className="h-8 w-[30px] shrink-0" />
        <span className="flex flex-col whitespace-nowrap leading-none">
          <span className="text-title">Secret Dashboard</span>
          <span className="mt-1 text-label text-text-faint">
            version <span className="text-text-muted">1.9</span>
          </span>
        </span>
      </NavLink>

      <ul className="contents lg:flex lg:flex-col lg:gap-0.5">
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <li key={to} className="min-w-0 flex-1 lg:flex-none">
            <NavLink
              to={to}
              className={({ isActive }) =>
                cn(
                  'state-layer flex w-full min-w-0 items-center rounded-control',
                  'transition-colors duration-[var(--duration-short)] ease-[var(--ease-standard)]',
                  'flex-col gap-1 px-0.5 py-1.5 font-medium',
                  'lg:flex-row lg:gap-3 lg:rounded-pill lg:px-4 lg:py-2.5',
                  isActive ? 'text-accent lg:bg-accent-soft' : 'text-text-muted hover:text-text'
                )
              }
            >
              {({ isActive }) => (
                <>
                  {/*
                    Material's bottom bar puts the active indicator behind the
                    icon, not around the whole item — a pill that has to enclose
                    the label as well is either enormous or clips it, and at six
                    destinations on a 375px screen it clips it.
                  */}
                  <span
                    className={cn(
                      'flex h-7 w-14 shrink-0 items-center justify-center rounded-pill',
                      'transition-colors duration-[var(--duration-short)] ease-[var(--ease-standard)]',
                      'lg:h-auto lg:w-auto lg:bg-transparent',
                      isActive ? 'bg-accent-soft' : 'bg-transparent'
                    )}
                  >
                    {/* Lucide, with an explicit size at every use — the icon must
                        not inherit a font size that happens to be nearby. */}
                    <Icon size={18} strokeWidth={1.75} aria-hidden />
                  </span>
                  <span className="w-full truncate text-center text-[10px] leading-none lg:w-auto lg:text-left lg:text-base lg:leading-normal">
                    {label}
                  </span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}

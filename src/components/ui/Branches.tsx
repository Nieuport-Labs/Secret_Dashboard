import type { ReactNode } from 'react'

import { cn } from '@/lib/cn'

/**
 * The elbowed list that hangs under a row.
 *
 * Shared, because the same shape now says the same thing in three places — the
 * stkd-SCRT queue, SCRT undelegating from validators in the wallet, and the
 * same undelegations on the staking screen. Two copies of a tree drawn with
 * absolutely positioned hairlines would be two trees within a week.
 *
 * The elbows do the work a heading would otherwise have to: everything here is
 * a consequence of the line above it.
 */
export function Branches({ children, gutter = false }: { children: ReactNode; gutter?: boolean }) {
  return (
    <ul
      className={cn(
        'mt-0.5 flex w-full flex-col gap-1 pl-4',
        // In a balance row the branches stop where the balance column stops:
        // the menu is the row's, not the queue's, and a branch running under
        // those three dots reads as though they belong to it. The inset is the
        // menu column plus its gap — 2rem + 1rem, 2.5rem + 1rem once fixed.
        gutter ? 'pr-12 sm:pr-14' : 'pr-2'
      )}
    >
      {children}
    </ul>
  )
}

export function Branch({ children, last }: { children: ReactNode; last?: boolean }) {
  return (
    <li className="relative flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 pl-8 text-label">
      {/* Down to this row's own elbow if it is the last one, through to the
          next row's if it is not — including across the gap between them. */}
      <span
        aria-hidden
        className={cn(
          'absolute left-0 top-0 w-px bg-border-strong',
          last ? 'h-[1.15rem]' : 'h-[calc(100%+0.25rem)]'
        )}
      />
      <span aria-hidden className="absolute left-0 top-[1.15rem] h-px w-3.5 bg-border-strong" />
      {children}
    </li>
  )
}

/**
 * How far through the unbonding period this one is.
 *
 * Nothing to show without a date: a request still waiting for its batch has no
 * unbonding delegation behind it and therefore no elapsed time, and a bar
 * sitting at zero would read as stuck rather than as queued.
 */
export function Progress({ at, seconds }: { at?: Date; seconds?: number }) {
  if (!at || !seconds)
    return <span className="min-w-0 flex-1 truncate text-text-faint">Waiting for the next batch</span>

  const remaining = at.getTime() - Date.now()
  const share = Math.min(1, Math.max(0, 1 - remaining / (seconds * 1000)))

  /*
   * A fixed width, and only where there is room for it. As a flexible column it
   * squeezed the validator's name down to "Sec…" in the wallet's narrow
   * balances column — and between a bar and a name, the name is the one
   * carrying information the reader cannot reconstruct. The date says the same
   * thing the bar does, in words, so a narrow screen loses nothing but the
   * picture.
   */
  return (
    <span className="hidden shrink-0 items-center lg:flex lg:w-20 xl:w-28">
      <span className="h-1 w-full overflow-hidden rounded-pill bg-surface">
        <span
          className="block h-full rounded-pill bg-accent"
          style={{ width: `${Math.round(share * 100)}%` }}
        />
      </span>
    </span>
  )
}

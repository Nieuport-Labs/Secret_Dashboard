import { Branch, Branches, Progress } from '@/components/ui/Branches'
import { DECIMALS, DISPLAY_DENOM } from '@/chains/secret4'
import { formatDisplayAmount } from '@/lib/format'
import { waitLabel } from '@/lib/wait'

export interface UnbondingRow {
  /** Base units of SCRT. */
  amount: string
  /**
   * When the chain releases it. Absent for a request that has not been sent
   * yet — Shade's queue holds one until the next batch goes out, and a date
   * invented for it would be a date the contract has not promised.
   */
  at?: Date
  /** Whose queue it is in — a validator's moniker, or the contract's name. */
  label?: string
  /**
   * What kind of wait this is, when a list holds more than one.
   *
   * Undelegating from a validator and redeeming a derivative both end in SCRT
   * landing in the same account, which is why they belong in one list — but
   * they are not the same thing, they do not take the same time, and only one
   * of them can be hurried by selling. So the row says which it is.
   */
  tag?: string
}

/**
 * SCRT undelegating, drawn the same way wherever it appears.
 *
 * One component for the wallet's SCRT row and for the staking screen, because
 * they are the same list of the same undelegations and were drifting into two
 * different answers to "when do I get it back" — a bare date on one screen, a
 * countdown and a bar on the other.
 *
 * The chain pays these out by itself on the day they mature, so there is
 * nothing to claim and no button: a list to read, not to act on.
 */
export default function UnbondingBranches({
  rows,
  seconds,
  gutter
}: {
  rows: UnbondingRow[]
  /** The chain's unbonding period, for drawing how far along each one is. */
  seconds?: number
  gutter?: boolean
}) {
  if (rows.length === 0) return null

  // Oldest first: the order they come back in. Anything without a date has not
  // been sent yet, so it is furthest away and sorts last.
  const ordered = [...rows].sort((a, b) => (a.at?.getTime() ?? Infinity) - (b.at?.getTime() ?? Infinity))

  return (
    <Branches gutter={gutter}>
      {ordered.map((row, index) => (
        <Branch
          key={`${row.label ?? 'row'}-${row.at?.getTime() ?? 'queued'}-${index}`}
          last={index === ordered.length - 1}
        >
          <span className="w-28 shrink-0 tabular-nums text-text">
            {formatDisplayAmount(row.amount, DECIMALS)} {DISPLAY_DENOM}
          </span>
          {row.label || row.tag ? (
            <span className="hidden min-w-0 flex-1 items-center gap-1.5 text-text-faint sm:flex">
              {row.tag ? (
                <span className="shrink-0 rounded-pill bg-accent-container px-1.5 py-px text-[0.6875rem] font-medium leading-[1.4] text-accent">
                  {row.tag}
                </span>
              ) : null}
              <span className="min-w-0 truncate">{row.label}</span>
            </span>
          ) : (
            <span className="min-w-0 flex-1" aria-hidden />
          )}
          {/* No bar without a date: the right-hand label already says it has
              not been sent, and a second phrase saying so is noise. */}
          {row.at ? <Progress at={row.at} seconds={seconds} /> : null}
          {/* The exact day is in the title: the countdown is what the question
              is about, but "which Tuesday" is a fair follow-up. */}
          <span className="shrink-0 text-text-faint" title={row.at?.toLocaleString()}>
            {waitLabel(row.at)}
          </span>
        </Branch>
      ))}
    </Branches>
  )
}

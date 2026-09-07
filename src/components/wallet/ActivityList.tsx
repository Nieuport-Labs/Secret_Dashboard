import { ArrowDownLeft, ArrowUpRight, ChevronDown, ExternalLink, RefreshCw, ShieldCheck } from 'lucide-react'
import { useState } from 'react'

import type { ActivityEntry, ActivityKind } from '@/hooks/useActivity'
import { explorerTxUrl } from '@/chains/secret4'
import { cn } from '@/lib/cn'
import { formatDisplayAmount, shortenAddress } from '@/lib/format'
import { tokenImageUrl } from '@/tokens/registry'

interface Props {
  entries: ActivityEntry[]
  loading: boolean
  /** Private tokens whose history could not be read. Not the same as having none. */
  unreadable: number
  publicError?: string
}

const LABELS: Record<ActivityKind, string> = {
  received: 'Received',
  sent: 'Sent',
  wrapped: 'Wrapped',
  unwrapped: 'Unwrapped',
  'bridged-in': 'Bridged in',
  'bridged-out': 'Bridged out',
  'received-private': 'Received',
  'sent-private': 'Sent'
}

/** Which way the balance moved, or `undefined` when it only changed form. */
function sign(kind: ActivityKind): '+' | '-' | undefined {
  switch (kind) {
    case 'received':
    case 'received-private':
    case 'bridged-in':
      return '+'
    case 'sent':
    case 'sent-private':
    case 'bridged-out':
      return '-'
    // Wrapping moves nothing out of the wallet — the same money changes form,
    // and a minus sign against it would read as a loss.
    default:
      return undefined
  }
}

function incoming(kind: ActivityKind): boolean {
  return sign(kind) !== '-'
}

/** Relative time, falling back to nothing rather than to a fabricated date. */
function when(seconds?: number): string | undefined {
  if (!seconds) return undefined

  const deltaSeconds = Math.round(seconds - Date.now() / 1000)
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  const steps: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['day', 86_400],
    ['hour', 3600],
    ['minute', 60]
  ]

  for (const [unit, size] of steps) {
    if (Math.abs(deltaSeconds) >= size) return format.format(Math.round(deltaSeconds / size), unit)
  }
  return format.format(deltaSeconds, 'second')
}

/**
 * What has happened to this account lately, public and private together.
 *
 * It sits beside the balances rather than under them because it answers a
 * different question — not "what do I have" but "what just happened" — and a
 * question you scan down the page to reach is one you stop asking.
 *
 * The public entries carry a transaction hash and link out to an explorer. The
 * private ones do not, and cannot: those movements are encrypted in contract
 * state, and the permit that reads them here is the only thing that can. That
 * asymmetry is not a gap in the feature, it is the feature.
 */
/**
 * How many entries stand on the page before the rest are folded away. Four is
 * what fits beside the balances without the column becoming a second list to
 * read — "what just happened" is a glance, not a study.
 */
const COLLAPSED = 4

export default function ActivityList({ entries, loading, unreadable, publicError }: Props) {
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? entries : entries.slice(0, COLLAPSED)
  const hidden = entries.length - shown.length

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-title">Recent activity</h2>
        {entries.length > COLLAPSED ? (
          <button
            type="button"
            onClick={() => setExpanded((open) => !open)}
            className="state-layer -mx-1.5 flex items-center gap-1 rounded-control px-1.5 py-0.5 text-label text-accent"
          >
            {expanded ? 'Show less' : 'See all'}
            <ChevronDown
              size={13}
              aria-hidden
              className={cn(
                'transition-transform duration-[var(--duration-short)] ease-[var(--ease-standard)]',
                expanded && 'rotate-180'
              )}
            />
          </button>
        ) : null}
      </div>

      {loading && entries.length === 0 ? (
        <div className="flex flex-col gap-1" aria-busy>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3 px-2 py-2.5">
              <span className="size-8 shrink-0 animate-pulse rounded-pill bg-surface" />
              <span className="h-4 flex-1 animate-pulse rounded-control bg-surface" />
            </div>
          ))}
        </div>
      ) : entries.length > 0 ? (
        <ul className="flex flex-col">
          {shown.map((entry) => {
            const at = when(entry.at)
            const prefix = sign(entry.kind)

            const body = (
              <>
                <span className="relative shrink-0">
                  {entry.token ? (
                    <img src={tokenImageUrl(entry.token)} alt="" className="size-8 rounded-pill" />
                  ) : (
                    <span className="flex size-8 items-center justify-center rounded-pill bg-surface text-text-muted">
                      {incoming(entry.kind) ? <ArrowDownLeft size={15} /> : <ArrowUpRight size={15} />}
                    </span>
                  )}
                  {entry.token ? (
                    <span
                      aria-hidden
                      className="glass absolute -bottom-1 -right-1 rounded-pill border border-glass-edge p-0.5 text-text-muted"
                    >
                      {incoming(entry.kind) ? <ArrowDownLeft size={11} /> : <ArrowUpRight size={11} />}
                    </span>
                  ) : null}
                </span>

                {/*
                  The asset leads and the verb follows, rather than the other
                  way round. This column is narrow enough that one of the two
                  gets truncated, and "Bridged out U…" is a worse thing to be
                  left holding than "USDC" plus a second line saying what
                  happened to it.
                */}
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate text-base font-medium">{entry.symbol}</span>
                    <span
                      className={cn(
                        'shrink-0 whitespace-nowrap text-base tabular-nums',
                        prefix === '+' ? 'text-positive' : 'text-text'
                      )}
                      title={entry.decimals === undefined ? 'Base units — decimal places unknown' : undefined}
                    >
                      {prefix ?? ''}
                      {entry.decimals === undefined
                        ? entry.amount
                        : formatDisplayAmount(entry.amount, entry.decimals)}
                    </span>
                  </span>
                  <span className="flex items-center gap-1 text-label text-text-faint">
                    {entry.private ? (
                      <ShieldCheck size={11} aria-hidden className="shrink-0 text-accent" />
                    ) : null}
                    <span className="truncate">
                      {LABELS[entry.kind]}
                      {entry.counterparty
                        ? ` ${incoming(entry.kind) ? 'from' : 'to'} ${shortenAddress(entry.counterparty, 6, 4)}`
                        : ''}
                      {at ? ` · ${at}` : ''}
                    </span>
                  </span>
                </span>
              </>
            )

            return (
              <li key={entry.id}>
                {entry.hash ? (
                  <a
                    href={explorerTxUrl(entry.hash)}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="state-layer group flex items-center gap-3 rounded-control px-2 py-2.5"
                  >
                    {body}
                    <ExternalLink
                      size={12}
                      aria-hidden
                      className="-ml-1 shrink-0 text-text-faint opacity-0 transition-opacity group-hover:opacity-100"
                    />
                  </a>
                ) : (
                  <span className="flex items-center gap-3 rounded-control px-2 py-2.5">{body}</span>
                )}
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="px-2 text-base text-text-muted">
          Nothing yet. Public transfers appear here as they happen; private ones need the query permit.
        </p>
      )}

      {hidden > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="state-layer rounded-control px-2 py-1.5 text-left text-label text-text-faint"
        >
          {hidden} more
        </button>
      ) : null}

      {unreadable > 0 ? (
        <p className="flex items-center gap-2 px-2 text-label text-text-faint">
          <RefreshCw size={13} aria-hidden />
          {unreadable} {unreadable === 1 ? "token's" : "tokens'"} private history could not be read
        </p>
      ) : null}

      {publicError ? (
        <p className="px-2 text-label text-text-faint">
          Public history is unavailable right now, so only private transfers are listed.
        </p>
      ) : null}
    </section>
  )
}

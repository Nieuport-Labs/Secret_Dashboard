import { ArrowDownLeft, ArrowUpRight, RefreshCw } from 'lucide-react'

import type { HistoryEntry } from '@/hooks/useTransferHistory'
import { formatAmount, shortenAddress } from '@/lib/format'
import { tokenImageUrl } from '@/tokens/registry'

interface Props {
  entries: HistoryEntry[]
  loading: boolean
  unreadable: number
  hasPermit: boolean
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
 * Private transfers, across every watched token.
 *
 * Nothing here is visible to an explorer: these movements live encrypted in
 * contract state, and the permit is what opens them.
 */
export default function HistoryList({ entries, loading, unreadable, hasPermit }: Props) {
  if (!hasPermit) return null

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Private transfers</h2>

      {loading && entries.length === 0 ? (
        <div className="flex flex-col gap-2" aria-busy>
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3 rounded-card bg-surface-1 px-4 py-3">
              <span className="size-8 animate-pulse rounded-pill bg-surface" />
              <span className="h-4 w-32 animate-pulse rounded-control bg-surface" />
              <span className="ml-auto h-4 w-20 animate-pulse rounded-control bg-surface" />
            </div>
          ))}
        </div>
      ) : entries.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {entries.map((entry, index) => {
            const incoming = entry.direction === 'in'
            const counterparty = incoming ? entry.transfer.sender : entry.transfer.receiver
            const at = when(entry.at)

            return (
              <li
                key={`${entry.token.address}-${entry.transfer.id ?? index}`}
                className="flex items-center gap-3 rounded-card bg-surface-1 px-4 py-3"
              >
                <span className="relative shrink-0">
                  <img src={tokenImageUrl(entry.token)} alt="" className="size-8 rounded-pill" />
                  <span
                    aria-hidden
                    className="absolute -bottom-1 -right-1 rounded-pill bg-surface-3 p-0.5 text-text-muted"
                  >
                    {incoming ? <ArrowDownLeft size={12} /> : <ArrowUpRight size={12} />}
                  </span>
                </span>

                <span className="min-w-0">
                  <span className="block truncate text-base font-medium">
                    {incoming ? 'Received' : entry.direction === 'self' ? 'Sent to self' : 'Sent'}{' '}
                    {entry.token.symbol}
                  </span>
                  <span className="block truncate text-sm text-text-faint">
                    {incoming ? 'from' : 'to'} {shortenAddress(counterparty)}
                    {at ? ` · ${at}` : ''}
                  </span>
                </span>

                <span className="ml-auto whitespace-nowrap text-base font-medium">
                  {incoming ? '+' : '-'}
                  {formatAmount(entry.transfer.coins.amount, { decimals: entry.token.decimals })}
                </span>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="rounded-card bg-surface-1 px-4 py-6 text-base text-text-muted">
          No transfers found in the tokens checked. These are private, so an explorer will not show them
          either.
        </p>
      )}

      {unreadable > 0 ? (
        <p className="flex items-center gap-2 text-sm text-text-faint">
          <RefreshCw size={14} aria-hidden />
          {unreadable} {unreadable === 1 ? "token's" : "tokens'"} history could not be read
        </p>
      ) : null}
    </section>
  )
}

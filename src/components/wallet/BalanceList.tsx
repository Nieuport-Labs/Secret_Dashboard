import { AlertCircle, RadioTower, RefreshCw, Search, Timer } from 'lucide-react'

import Button from '@/components/ui/Button'
import type { TokenBalance } from '@/hooks/useBalances'
import type { PushStatus } from '@/hooks/useArrivals'
import { formatDisplayAmount, formatFiat } from '@/lib/format'
import { tokenImageUrl } from '@/tokens/registry'
import { useSettings } from '@/store/settings'

interface Props {
  tokens: TokenBalance[]
  loading: boolean
  scanning: boolean
  scanProgress: [number, number]
  onScanAll: () => void
  pushStatus: PushStatus
}

/**
 * Private token balances.
 *
 * Rows are grouped by what the read actually returned. A zero balance and a
 * failed read look identical if both render as "0", and only one of them means
 * the account holds nothing — so a token that could not be read says so.
 */
export default function BalanceList({
  tokens,
  loading,
  scanning,
  scanProgress,
  onScanAll,
  pushStatus
}: Props) {
  const currency = useSettings((state) => state.currency)

  const held = tokens.filter((row) => row.outcome.status === 'ok' && row.outcome.amount !== '0')
  const unreadable = tokens.filter(
    (row) => row.outcome.status === 'error' || row.outcome.status === 'unauthorized'
  )
  const empty = tokens.length - held.length - unreadable.length

  if (loading && tokens.length === 0) {
    return (
      <div className="flex flex-col gap-3" aria-busy>
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3 rounded-card bg-surface-1 p-4">
            <span className="size-8 animate-pulse rounded-pill bg-surface" />
            <span className="h-4 w-20 animate-pulse rounded-control bg-surface" />
            <span className="ml-auto h-4 w-24 animate-pulse rounded-control bg-surface" />
          </div>
        ))}
      </div>
    )
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <span className="flex items-center gap-2.5">
          <h2 className="text-title">Private tokens</h2>
          <PushIndicator status={pushStatus} />
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={onScanAll}
          loading={scanning}
          icon={scanning ? undefined : <Search size={16} aria-hidden />}
        >
          {scanning ? `Scanning ${scanProgress[0]} of ${scanProgress[1]}` : 'Scan all tokens'}
        </Button>
      </div>

      {held.length > 0 ? (
        <ul className="divide-y divide-border overflow-hidden rounded-card bg-surface-1">
          {held.map((row) => (
            <li key={row.token.address} className="flex items-center gap-3 px-5 py-3.5">
              <img src={tokenImageUrl(row.token)} alt="" className="size-8 shrink-0 rounded-pill" />
              <span className="min-w-0">
                <span className="block truncate text-body font-medium">{row.token.symbol}</span>
                {row.token.description ? (
                  <span className="block truncate text-sm text-text-faint">{row.token.description}</span>
                ) : null}
              </span>
              <span className="ml-auto text-right">
                <span className="block text-body font-medium tabular-nums">
                  {row.outcome.status === 'ok'
                    ? formatDisplayAmount(row.outcome.amount, row.token.decimals)
                    : null}
                </span>
                {row.fiat !== undefined ? (
                  <span className="block text-label text-text-faint">{formatFiat(row.fiat, currency)}</span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-card bg-surface-1 px-4 py-6 text-base text-text-muted">
          {tokens.length === 0
            ? 'Sign the query permit to read your private balances.'
            : `No balance in the ${tokens.length} ${tokens.length === 1 ? 'token' : 'tokens'} checked. Scan all tokens to look through the whole registry.`}
        </p>
      )}

      {/* An unreadable token is worth naming. Silently omitting it would let
          someone conclude they hold nothing when the contract simply did not answer. */}
      {unreadable.length > 0 ? (
        <div className="flex items-start gap-3 rounded-card bg-surface-1 px-4 py-3">
          <AlertCircle size={18} aria-hidden className="mt-0.5 shrink-0 text-text-muted" />
          <p className="text-base text-text-muted">
            {unreadable.length} {unreadable.length === 1 ? 'token' : 'tokens'} could not be read
            {unreadable.some((row) => row.outcome.status === 'unauthorized')
              ? ', some because the permit was rejected'
              : ''}
            . This is not the same as holding none of them.
          </p>
        </div>
      ) : null}

      {empty > 0 && held.length > 0 ? (
        <p className="flex items-center gap-2 text-sm text-text-faint">
          <RefreshCw size={14} aria-hidden />
          {empty} more checked and empty
        </p>
      ) : null}
    </section>
  )
}

/**
 * Whether arrivals show up the instant they happen, or on the next refresh.
 *
 * Worth saying out loud: silence means something different in each mode, and a
 * user watching for an incoming transfer deserves to know which one they are in.
 */
function PushIndicator({ status }: { status: PushStatus }) {
  if (status === 'live') {
    return (
      <span className="flex items-center gap-1 text-sm text-positive" title="Arrivals appear immediately">
        <RadioTower size={14} aria-hidden />
        Live
      </span>
    )
  }
  if (status === 'connecting') {
    return <span className="text-sm text-text-faint">Connecting…</span>
  }
  return (
    <span
      className="flex items-center gap-1 text-sm text-text-faint"
      title={
        status === 'off'
          ? 'Push notifications are off. Balances refresh every couple of minutes.'
          : 'Push is unavailable. Balances refresh every couple of minutes.'
      }
    >
      <Timer size={14} aria-hidden />
      Checking periodically
    </span>
  )
}

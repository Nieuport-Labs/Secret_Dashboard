import { Activity } from 'lucide-react'
import { useEffect, useState } from 'react'

import { DISPLAY_DENOM } from '@/chains/secret4'
import { resolveLcdUrl } from '@/lib/endpoint'
import { formatDisplayAmount, formatFiat } from '@/lib/format'
import { fetchChainStats, fetchTvl, type ChainStats } from '@/lib/network'
import { fetchPrices } from '@/lib/prices'
import { useSettings } from '@/store/settings'
import { useWallet } from '@/store/wallet'

/**
 * What the chain is doing.
 *
 * Everything except TVL and price is read from Secret's own modules rather than
 * a third party's scraper — the one the reference dashboard uses stopped
 * resolving, and took five of its panels with it.
 */
export default function Network() {
  const client = useWallet((state) => state.queryClient)
  const lcdOverride = useSettings((state) => state.lcdOverride)
  const currency = useSettings((state) => state.currency)

  const [stats, setStats] = useState<ChainStats | undefined>()
  const [tvl, setTvl] = useState<number | undefined>()
  const [price, setPrice] = useState<number | undefined>()
  const [error, setError] = useState<string | undefined>()

  useEffect(() => {
    if (!client) return
    let cancelled = false

    const run = async () => {
      try {
        const lcd = await resolveLcdUrl(lcdOverride)
        const [chain, llama, prices] = await Promise.all([
          fetchChainStats(lcd, client),
          fetchTvl(),
          fetchPrices(['secret'], currency.toLowerCase()).catch(() => new Map<string, number>())
        ])
        if (cancelled) return
        setStats(chain)
        setTvl(llama)
        setPrice(prices.get('secret'))
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught))
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [client, lcdOverride, currency])

  if (error) {
    return (
      <p className="text-base text-text-muted" role="alert">
        The chain could not be read: {error}
      </p>
    )
  }

  if (!stats) {
    return (
      <div
        className="mx-auto grid max-w-[900px] gap-px overflow-hidden rounded-card bg-border sm:grid-cols-2 lg:grid-cols-3"
        aria-busy
      >
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-24 animate-pulse card" />
        ))}
      </div>
    )
  }

  const marketCap = price !== undefined ? (Number(stats.totalSupply) / 1e6) * price : undefined

  return (
    <div className="mx-auto flex max-w-[900px] flex-col gap-8">
      <h1 className="text-display">Network</h1>

      <div className="grid divide-y divide-border overflow-hidden card sm:grid-cols-2 sm:divide-x lg:grid-cols-3 [&>*:nth-child(-n+2)]:sm:border-t-0">
        <Stat label={`${DISPLAY_DENOM} price`} value={formatFiat(price, currency)} />
        <Stat label="Market cap" value={formatFiat(marketCap, currency)} />
        <Stat
          label="Value locked"
          value={tvl === undefined ? 'Unavailable' : formatFiat(tvl, 'USD')}
          note={tvl === undefined ? 'DefiLlama could not be reached' : 'via DefiLlama'}
        />

        <Stat
          label="Staked"
          value={`${(stats.bondedRatio * 100).toFixed(1)}%`}
          note={`${formatDisplayAmount(stats.bonded)} of ${formatDisplayAmount(stats.totalSupply)} ${DISPLAY_DENOM}`}
        />
        <Stat
          label="Inflation"
          value={stats.inflation === undefined ? 'Unavailable' : `${(stats.inflation * 100).toFixed(2)}%`}
          note="new issuance per year"
        />
        <Stat label="Active validators" value={String(stats.bondedValidators)} note="bonded set" />

        <Stat
          label="Block height"
          value={Number(stats.height).toLocaleString()}
          note={stats.blockTime.toLocaleTimeString()}
        />
        <Stat
          label="Community pool"
          value={
            stats.communityPool === undefined
              ? 'Unavailable'
              : `${formatDisplayAmount(stats.communityPool)} ${DISPLAY_DENOM}`
          }
        />
      </div>

      <p className="flex items-start gap-2 text-sm text-text-faint">
        <Activity size={14} aria-hidden className="mt-0.5 shrink-0" />
        Read from the chain directly, except price and value locked. Nothing here depends on a third-party
        indexer staying online.
      </p>
    </div>
  )
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="p-5">
      <p className="text-label text-text-muted">{label}</p>
      <p className="mt-1.5 text-headline tabular-nums">{value}</p>
      {note ? <p className="mt-1 text-label text-text-faint">{note}</p> : null}
    </div>
  )
}

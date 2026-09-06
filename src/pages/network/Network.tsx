import { Activity } from 'lucide-react'
import { useEffect, useState } from 'react'

import Sparkline, { type SeriesPoint } from '@/components/ui/Sparkline'
import { DISPLAY_DENOM } from '@/chains/secret4'
import { cn } from '@/lib/cn'
import { resolveLcdUrl } from '@/lib/endpoint'
import { formatDisplayAmount, formatFiat } from '@/lib/format'
import { fetchChainStats, fetchTvl, fetchTvlHistory, type ChainStats } from '@/lib/network'
import { fetchPriceHistory, fetchPrices } from '@/lib/prices'
import { useSettings } from '@/store/settings'
import { useWallet } from '@/store/wallet'

/** Ranges the price chart offers, as days back. */
const RANGES = [
  { days: 7, label: '7d' },
  { days: 30, label: '30d' },
  { days: 90, label: '90d' },
  { days: 365, label: '1y' }
] as const

/**
 * What the chain is doing.
 *
 * Everything except price and value locked is read from Secret's own modules
 * rather than a third party's scraper — the one the reference dashboard uses
 * stopped resolving, and took five of its panels with it.
 *
 * The charts are the two series that are genuinely time-shaped. The rest are
 * facts about now, and a sparkline under each would be decoration pretending to
 * be information.
 */
export default function Network() {
  const client = useWallet((state) => state.queryClient)
  const lcdOverride = useSettings((state) => state.lcdOverride)
  const currency = useSettings((state) => state.currency)

  const [stats, setStats] = useState<ChainStats | undefined>()
  const [tvl, setTvl] = useState<number | undefined>()
  const [price, setPrice] = useState<number | undefined>()
  const [error, setError] = useState<string | undefined>()

  const [days, setDays] = useState<number>(30)
  const [priceSeries, setPriceSeries] = useState<SeriesPoint[]>([])
  const [volumeSeries, setVolumeSeries] = useState<SeriesPoint[]>([])
  const [tvlSeries, setTvlSeries] = useState<SeriesPoint[]>([])

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

  // History is fetched apart from the headline figures: it is slower, it
  // changes with the range control, and a rate-limited CoinGecko must not take
  // the whole page down with it.
  useEffect(() => {
    let cancelled = false
    void fetchPriceHistory('secret', days, currency.toLowerCase())
      .then(({ prices, volumes }) => {
        if (cancelled) return
        setPriceSeries(prices)
        setVolumeSeries(volumes)
      })
      .catch(() => {
        if (!cancelled) {
          setPriceSeries([])
          setVolumeSeries([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [days, currency])

  useEffect(() => {
    let cancelled = false
    void fetchTvlHistory().then((rows) => {
      if (!cancelled) setTvlSeries(rows)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (error) {
    return (
      <p className="text-base text-text-muted" role="alert">
        The chain could not be read: {error}
      </p>
    )
  }

  if (!stats) {
    return (
      <div className="mx-auto flex max-w-[900px] flex-col gap-10" aria-busy>
        <div className="h-8 w-40 animate-pulse rounded-control bg-surface" />
        <div className="h-56 animate-pulse card" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-24 animate-pulse card" />
          ))}
        </div>
      </div>
    )
  }

  const marketCap = price !== undefined ? (Number(stats.totalSupply) / 1e6) * price : undefined
  const fiat = (value: number) => formatFiat(value, currency)
  const usd = (value: number) => formatFiat(value, 'USD')

  // TVL history is always the full record; the range control trims it so both
  // charts are talking about the same window.
  const tvlWindow = tvlSeries.filter((point) => point.t >= Date.now() - days * 86_400_000)

  return (
    <div className="mx-auto flex max-w-[900px] flex-col gap-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-display">Network</h1>
        <div className="flex gap-1">
          {RANGES.map((range) => (
            <button
              key={range.days}
              type="button"
              onClick={() => setDays(range.days)}
              aria-pressed={days === range.days}
              className={cn(
                'state-layer rounded-pill border border-border px-3 py-1 text-label font-medium',
                days === range.days ? 'bg-accent-container text-accent' : 'text-text-muted'
              )}
            >
              {range.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={`${DISPLAY_DENOM} price`} value={formatFiat(price, currency)} source="CoinGecko">
          <Sparkline points={priceSeries} format={fiat} label={`${DISPLAY_DENOM} price`} />
        </Panel>

        <Panel title="Value locked" value={tvl === undefined ? 'Unavailable' : usd(tvl)} source="DefiLlama">
          <Sparkline points={tvlWindow} format={usd} label="Value locked in Secret contracts" />
        </Panel>
      </div>

      <Panel
        title="Trading volume"
        value={volumeSeries.length > 0 ? fiat(volumeSeries[volumeSeries.length - 1]!.v) : 'Unavailable'}
        source="CoinGecko, 24h rolling"
      >
        <Sparkline points={volumeSeries} format={fiat} label="Daily trading volume" area={false} />
      </Panel>

      <div className="grid divide-y divide-border overflow-hidden card sm:grid-cols-2 sm:divide-x lg:grid-cols-3 [&>*:nth-child(-n+2)]:sm:border-t-0">
        <Stat label="Market cap" value={formatFiat(marketCap, currency)} />
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

      <p className="flex items-start gap-2 text-label text-text-faint">
        <Activity size={14} aria-hidden className="mt-px shrink-0" />
        Read from the chain directly, except price and value locked. Nothing here depends on a third-party
        indexer staying online.
      </p>
    </div>
  )
}

function Panel({
  title,
  value,
  source,
  children
}: {
  title: string
  value?: string
  source: string
  children: React.ReactNode
}) {
  return (
    <section className="card flex flex-col gap-4 p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-title">{title}</h2>
        <span className="text-label text-text-faint">{source}</span>
      </div>
      {value ? <p className="-mb-2 text-headline tabular-nums">{value}</p> : null}
      {children}
    </section>
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

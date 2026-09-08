import { Activity } from 'lucide-react'
import { useEffect, useState } from 'react'

import BarChart from '@/components/ui/BarChart'
import Sparkline, { type SeriesPoint } from '@/components/ui/Sparkline'
import { DISPLAY_DENOM } from '@/chains/secret4'
import { cn } from '@/lib/cn'
import { resolveLcdUrl } from '@/lib/endpoint'
import { errorMessage } from '@/lib/errors'
import { formatDisplayAmount, formatFiat } from '@/lib/format'
import {
  fetchChainStats,
  fetchTvl,
  fetchTvlHistory,
  fetchUnbonding,
  type ChainStats,
  type UnbondingData
} from '@/lib/network'
import { fetchOsmosisPrice } from '@/lib/osmosisPrice'
import { fetchPriceHistory } from '@/lib/prices'
import SupplyBreakdown from '@/pages/network/components/SupplyBreakdown'
import { useSettings } from '@/store/settings'
import { useWallet } from '@/store/wallet'

/** Ranges the price and supply charts offer, as days back. */
const RANGES = [
  { days: 7, label: '7d' },
  { days: 30, label: '30d' },
  { days: 90, label: '90d' },
  { days: 365, label: '1y' }
] as const

/** The one chart on the page, picked by tab rather than shown five times over. */
const METRICS = [
  { key: 'price', label: 'Price' },
  { key: 'supply', label: 'Supply' },
  { key: 'tvl', label: 'TVL' },
  { key: 'unbonding', label: 'Unbonding' },
  { key: 'breakdown', label: 'Breakdown' }
] as const

type Metric = (typeof METRICS)[number]['key']

/** A metric picks its own range control and its own chart shape — a column
 *  chart for daily buckets, a line for a continuous quantity, or neither for
 *  the breakdown, which is a snapshot rather than a series over time. */
const RANGED: Metric[] = ['price', 'supply', 'tvl']
const COLUMN: Metric[] = ['unbonding']

/** Lavender.Five's amounts already arrive in display units, unlike everything
 *  read from the chain itself — this only groups and rounds, no base-unit math. */
function formatScrt(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 })
}

/**
 * What the chain is doing.
 *
 * Chain facts (bonded ratio, inflation, community pool, block height) come
 * from Secret's own modules rather than a third party's scraper — the one the
 * reference dashboard uses stopped resolving, and took five of its panels
 * with it. Everything else names its own source in the chart itself, since
 * each comes from somewhere different: Osmosis for the live price (no rate
 * limit worth mentioning), CoinGecko for its history (rate-limited, so it
 * fails to "no history" rather than taking the page down), DefiLlama for
 * value locked, and Lavender.Five's node metrics for anything about the
 * unbonding queue or IBC balances, which no chain module tracks.
 */
export default function Network() {
  const client = useWallet((state) => state.queryClient)
  const lcdOverride = useSettings((state) => state.lcdOverride)

  const [stats, setStats] = useState<ChainStats | undefined>()
  const [tvl, setTvl] = useState<number | undefined>()
  const [price, setPrice] = useState<number | undefined>()
  const [error, setError] = useState<string | undefined>()

  const [metric, setMetric] = useState<Metric>('price')
  const [days, setDays] = useState<number>(30)
  const [priceSeries, setPriceSeries] = useState<SeriesPoint[]>([])
  const [tvlSeries, setTvlSeries] = useState<SeriesPoint[]>([])
  const [unbonding, setUnbonding] = useState<UnbondingData | undefined>()

  useEffect(() => {
    if (!client) return
    let cancelled = false

    const run = async () => {
      try {
        const [chain, llama] = await Promise.all([
          resolveLcdUrl(lcdOverride).then((lcd) => fetchChainStats(lcd, client)),
          fetchTvl()
        ])
        if (cancelled) return
        setStats(chain)
        setTvl(llama)
      } catch (caught) {
        if (!cancelled) setError(errorMessage(caught))
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [client, lcdOverride])

  // Kept apart from the chain read above: it is a different source entirely,
  // and it failing must not take the rest of the page's own numbers down
  // with it.
  useEffect(() => {
    let cancelled = false
    void fetchOsmosisPrice('SCRT').then((value) => {
      if (!cancelled) setPrice(value)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // History is fetched apart from the headline figures too: it is slower, it
  // changes with the range control, and a rate-limited CoinGecko must not take
  // the whole page down with it. Only the historical shape comes from here —
  // the current price above is Osmosis's, which does not publish history.
  useEffect(() => {
    let cancelled = false
    void fetchPriceHistory('secret', days, 'usd')
      .then(({ prices }) => {
        if (!cancelled) setPriceSeries(prices)
      })
      .catch(() => {
        if (!cancelled) setPriceSeries([])
      })
    return () => {
      cancelled = true
    }
  }, [days])

  useEffect(() => {
    let cancelled = false
    void fetchTvlHistory().then((rows) => {
      if (!cancelled) setTvlSeries(rows)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void fetchUnbonding().then((data) => {
      if (!cancelled) setUnbonding(data)
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
      <div className="mx-auto flex max-w-[1100px] flex-col gap-10" aria-busy>
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
  const usd = (value: number | undefined) => formatFiat(value, 'USD')

  // TVL history is always the full record; the range control trims it so both
  // charts are talking about the same window.
  const tvlWindow = tvlSeries.filter((point) => point.t >= Date.now() - days * 86_400_000)

  // No third party publishes circulating-supply history for SCRT, and
  // deriving one from CoinGecko's market cap ÷ price does not work — their
  // own circulating-supply bookkeeping has at least one hard correction in
  // it, which shows up as a step no real supply took. Secret's own supply
  // grows by `inflation` a year with no other lever on it, so projecting
  // today's chain-reported total backward at that rate draws the same smooth
  // curve the real history would, without borrowing anyone else's data error.
  const totalSupplyNow = Number(stats.totalSupply) / 1e6
  const inflation = stats.inflation ?? 0
  const supplySeries: SeriesPoint[] = Array.from({ length: days + 1 }, (_, index) => {
    const daysAgo = days - index
    return { t: Date.now() - daysAgo * 86_400_000, v: totalSupplyNow / (1 + inflation) ** (daysAgo / 365) }
  })

  const charts: Record<
    Metric,
    { title: string; source: string; value: string; points: SeriesPoint[]; format: (value: number) => string }
  > = {
    price: {
      title: `${DISPLAY_DENOM} price`,
      source: 'Osmosis · history from CoinGecko',
      value: usd(price),
      points: priceSeries,
      format: usd
    },
    supply: {
      title: 'Total supply',
      source: `Secret chain · projected at ${(inflation * 100).toFixed(1)}%/yr inflation`,
      value: `${formatScrt(totalSupplyNow)} ${DISPLAY_DENOM}`,
      points: supplySeries,
      format: (value) => `${formatScrt(value)} ${DISPLAY_DENOM}`
    },
    tvl: {
      title: 'Value locked',
      source: 'DefiLlama',
      value: tvl === undefined ? 'Unavailable' : usd(tvl),
      points: tvlWindow,
      format: usd
    },
    unbonding: {
      title: 'SCRT unbonding',
      source: 'Lavender.Five Nodes',
      value: unbonding === undefined ? 'Unavailable' : `${formatScrt(unbonding.total)} ${DISPLAY_DENOM}`,
      // Points run forward, not back: each is a day still ahead in the
      // 21-day unbonding queue, not a day already past.
      points: unbonding?.byDate ?? [],
      format: (value) => `${formatScrt(value)} ${DISPLAY_DENOM}`
    },
    breakdown: {
      title: 'Supply breakdown',
      source: 'Secret chain + Lavender.Five',
      value: `${formatScrt(Number(stats.totalSupply) / 1e6)} ${DISPLAY_DENOM} total`,
      points: [],
      format: (value) => `${formatScrt(value)} ${DISPLAY_DENOM}`
    }
  }
  const chart = charts[metric]

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-10">
      <h1 className="text-display">Network</h1>

      <div className="grid divide-y divide-border overflow-hidden card sm:grid-cols-2 sm:divide-x lg:grid-cols-3 [&>*:nth-child(-n+2)]:sm:border-t-0">
        <Stat label="Market cap" value={usd(marketCap)} />
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

      <section className="card flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1">
            {METRICS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setMetric(option.key)}
                aria-pressed={metric === option.key}
                className={cn(
                  'state-layer rounded-pill border border-border px-3 py-1 text-label font-medium',
                  metric === option.key ? 'bg-accent-container text-accent' : 'text-text-muted'
                )}
              >
                {option.label}
              </button>
            ))}
          </div>

          {RANGED.includes(metric) ? (
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
          ) : null}
        </div>

        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-title">{chart.title}</h2>
          <span className="text-label text-text-faint">{chart.source}</span>
        </div>
        <p className="-mb-2 text-headline tabular-nums">{chart.value}</p>

        {metric === 'breakdown' ? (
          <SupplyBreakdown
            totalSupply={stats.totalSupply}
            bonded={stats.bonded}
            communityPool={stats.communityPool}
            unbondingTotal={unbonding?.total}
            ibcOut={unbonding?.ibcOut}
          />
        ) : COLUMN.includes(metric) ? (
          <BarChart points={chart.points} format={chart.format} label={chart.title} height={340} />
        ) : (
          <Sparkline points={chart.points} format={chart.format} label={chart.title} height={340} />
        )}
      </section>

      <p className="flex items-start gap-2 text-label text-text-faint">
        <Activity size={14} aria-hidden className="mt-px shrink-0" />
        Read from the chain directly, except current price (Osmosis), price history (CoinGecko), value locked
        (DefiLlama), and the unbonding queue and IBC total (Lavender.Five).
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

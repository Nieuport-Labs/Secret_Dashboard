/**
 * Token prices, from CoinGecko.
 *
 * A price is decoration: it never decides what a transaction sends. So a
 * failure here degrades to "no price" and the balance still shows. What must
 * never happen is a missing price rendering as `$0.00`, which reads as
 * "worthless" rather than "unknown".
 */

const COINGECKO = 'https://api.coingecko.com/api/v3'

/** Cached for the page load. Prices move, but not enough to re-fetch per render. */
let cache: { at: number; currency: string; prices: Map<string, number> } | undefined
const CACHE_MS = 60_000

/**
 * @param ids CoinGecko ids. Tokens without one are simply absent from the result.
 * @returns id → unit price. A missing key means no price, which is not zero.
 */
export async function fetchPrices(ids: string[], currency = 'usd'): Promise<Map<string, number>> {
  const wanted = [...new Set(ids.filter(Boolean))].sort()
  if (wanted.length === 0) return new Map()

  const fresh = cache && Date.now() - cache.at < CACHE_MS && cache.currency === currency
  if (fresh && wanted.every((id) => cache!.prices.has(id))) return cache!.prices

  const url =
    `${COINGECKO}/simple/price?ids=${encodeURIComponent(wanted.join(','))}` +
    `&vs_currencies=${encodeURIComponent(currency)}`

  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000)
  })
  if (!response.ok) throw new Error(`Price lookup failed: HTTP ${response.status}`)

  const body = (await response.json()) as Record<string, Record<string, number>>
  const prices = new Map<string, number>()
  for (const [id, quotes] of Object.entries(body)) {
    const value = quotes?.[currency]
    if (typeof value === 'number') prices.set(id, value)
  }

  cache = { at: Date.now(), currency, prices }
  return prices
}

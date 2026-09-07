/**
 * A token's spot price, from Osmosis's own price service rather than
 * CoinGecko.
 *
 * CoinGecko's public API rate-limits by IP with no key available, and that
 * limit is shared with every other tool on the same network — one page
 * reload during testing can leave it tripped for everyone after. Osmosis's
 * SQS instead prices whatever trades on its own DEX directly from the pools
 * themselves, with no key and nothing tighter than the chain's own load.
 */
const SQS = 'https://sqs.osmosis.zone'

/**
 * @param symbol A human ticker Osmosis recognizes on its own asset list (e.g. `SCRT`).
 * @returns The token's price against Osmosis's pooled USD stand-in (alloyed
 * USDC) — close enough to USD to treat as one for display. `undefined` when
 * unavailable, never `0`, which would read as "worthless" rather than "unknown".
 */
export async function fetchOsmosisPrice(symbol: string): Promise<number | undefined> {
  try {
    const url = `${SQS}/tokens/prices?base=${encodeURIComponent(symbol)}&humanDenoms=true`
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000)
    })
    if (!response.ok) return undefined

    // Shaped as { [baseDenom]: { [quoteDenom]: "price as a string" } } — the
    // base and quote denoms are internal (often an ibc/HASH), so nothing
    // reads them by name; whatever quote the pool happens to price against is
    // taken as-is.
    const body = (await response.json()) as Record<string, Record<string, string> | undefined>
    const quotes = Object.values(body)[0]
    const raw = quotes ? Object.values(quotes)[0] : undefined
    const value = raw !== undefined ? Number(raw) : undefined

    return value !== undefined && Number.isFinite(value) ? value : undefined
  } catch {
    return undefined
  }
}

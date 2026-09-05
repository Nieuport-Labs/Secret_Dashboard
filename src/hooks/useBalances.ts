import { useCallback, useEffect, useState } from 'react'

import { queryNativeBalance } from '@/lib/bank'
import { mapWithLimit } from '@/lib/concurrency'
import { fiatValue } from '@/lib/format'
import type { Permit } from '@/lib/permit'
import { fetchPrices } from '@/lib/prices'
import { queryBalance, type BalanceOutcome } from '@/lib/snip20'
import { loadWatchlist, rememberTokens } from '@/lib/watchlist'
import { allTokenAddresses, tokenByAddress, TOKENS, type TokenInfo } from '@/tokens/registry'
import { useSettings } from '@/store/settings'
import { useWallet } from '@/store/wallet'

/** CoinGecko's id for SCRT itself. */
const SCRT_PRICE_ID = 'secret'

/**
 * How many contract reads run at once. Deliberately modest: the chain has two
 * working public providers, and a sweep of the whole registry is 96 encrypted
 * queries.
 */
const QUERY_CONCURRENCY = 6

export interface TokenBalance {
  token: TokenInfo
  outcome: BalanceOutcome
  /** Absent when there is no price for this token, which is not the same as zero. */
  fiat?: number
}

export interface Balances {
  /** Native SCRT, in base units. The only thing on this chain that pays gas. */
  native?: string
  nativeFiat?: number
  tokens: TokenBalance[]
  loading: boolean
  /** Set when the native read failed. SNIP-20 failures are per token, in `outcome`. */
  error?: string
  /** True while a full-registry sweep is running. */
  scanning: boolean
  /** Progress of that sweep, as [done, total]. */
  scanProgress: [number, number]
  refresh: () => void
  /** Read every token in the registry, not just the remembered ones. */
  scanAll: () => void
}

/**
 * Native and SNIP-20 balances for the connected account.
 *
 * Only the account's watchlist is read on load — sSCRT plus whatever has shown
 * a balance before. `scanAll` reads the whole registry on request. SNIP-20
 * reads need the permit; the native read does not, so a balance still shows
 * before one is signed.
 *
 * Each token carries its own outcome, so one unreachable contract is one
 * unavailable row rather than an empty list.
 */
export function useBalances(permit: Permit | undefined): Balances {
  const address = useWallet((state) => state.address)
  const client = useWallet((state) => state.queryClient)
  const currency = useSettings((state) => state.currency)

  const [native, setNative] = useState<string | undefined>()
  const [scrtPrice, setScrtPrice] = useState<number | undefined>()
  const [tokens, setTokens] = useState<TokenBalance[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [scanning, setScanning] = useState(false)
  const [scanProgress, setScanProgress] = useState<[number, number]>([0, 0])
  const [nonce, setNonce] = useState(0)
  const [sweep, setSweep] = useState(false)

  const refresh = useCallback(() => setNonce((n) => n + 1), [])
  const scanAll = useCallback(() => {
    setSweep(true)
    setNonce((n) => n + 1)
  }, [])

  useEffect(() => {
    if (!address || !client) {
      setNative(undefined)
      setTokens([])
      return
    }

    let cancelled = false
    setLoading(true)
    setError(undefined)
    if (sweep) {
      setScanning(true)
      setScanProgress([0, 0])
    }

    const run = async () => {
      const contracts = permit ? (sweep ? allTokenAddresses() : loadWatchlist(address)) : []
      const priceIds = [SCRT_PRICE_ID, ...TOKENS.map((t) => t.coingeckoId).filter(Boolean)] as string[]

      const [nativeResult, prices] = await Promise.all([
        // Caught by hand rather than with allSettled, so the reason survives
        // into a message instead of becoming an opaque rejected slot.
        queryNativeBalance(client, address).catch((caught: unknown) => caught as Error),
        // Prices are decoration; a failure must not cost anyone their balances.
        fetchPrices(priceIds, currency.toLowerCase()).catch(() => new Map<string, number>())
      ])

      if (cancelled) return

      if (nativeResult instanceof Error) {
        setError(nativeResult.message)
        setNative(undefined)
      } else {
        setNative(nativeResult)
      }
      setScrtPrice(prices.get(SCRT_PRICE_ID))

      const outcomes = await mapWithLimit(
        contracts,
        QUERY_CONCURRENCY,
        async (contract) => [contract, await queryBalance(client, permit!, contract)] as const,
        (done, total) => {
          if (!cancelled && sweep) setScanProgress([done, total])
        }
      )

      if (cancelled) return

      const rows: TokenBalance[] = []
      const held: string[] = []

      for (const [contract, outcome] of outcomes) {
        const token = tokenByAddress(contract)
        if (!token) continue

        if (outcome.status === 'ok' && outcome.amount !== '0') held.push(contract)

        rows.push({
          token,
          outcome,
          fiat:
            outcome.status === 'ok' && token.coingeckoId
              ? fiatValue(outcome.amount, prices.get(token.coingeckoId), token.decimals)
              : undefined
        })
      }

      // Anything with a balance is worth reading again next time without a sweep.
      rememberTokens(address, held)

      setTokens(rows)
      setLoading(false)
      setScanning(false)
    }

    void run()

    return () => {
      cancelled = true
    }
    // `nonce` is the manual refresh trigger.
  }, [address, client, permit, currency, nonce, sweep])

  return {
    native,
    nativeFiat: native === undefined ? undefined : fiatValue(native, scrtPrice),
    tokens,
    loading,
    error,
    scanning,
    scanProgress,
    refresh,
    scanAll
  }
}

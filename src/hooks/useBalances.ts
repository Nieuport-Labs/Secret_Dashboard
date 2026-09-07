import { useCallback, useEffect, useState } from 'react'

import { queryAllBalances } from '@/lib/bank'
import { mapWithLimit } from '@/lib/concurrency'
import { fiatValue } from '@/lib/format'
import type { Permit } from '@/lib/permit'
import { fetchPrices } from '@/lib/prices'
import { queryBalance, type BalanceOutcome } from '@/lib/snip20'
import { loadWatchlist, rememberTokens } from '@/lib/watchlist'
import { allTokenAddresses, allTokens, tokenByAddress, type TokenInfo } from '@/tokens/registry'
import { tokenAddressForBankDenom } from '@/tokens/routes'
import { DENOM } from '@/chains/secret4'
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

/**
 * Balances are re-read on this interval regardless of push notifications.
 *
 * A WebSocket can die without saying so, a node can drop a subscription, and a
 * token may have no notification channels at all. SNIP-52 makes an arrival show
 * up immediately; this is what makes it show up at all.
 */
const REFRESH_INTERVAL_MS = 120_000

export interface TokenBalance {
  token: TokenInfo
  outcome: BalanceOutcome
  /** Absent when there is no price for this token, which is not the same as zero. */
  fiat?: number
}

/** A denomination held in the open, in the bank module. */
export interface PublicBalance {
  /** `uscrt` or an `ibc/…` voucher. */
  denom: string
  /** Base units. */
  amount: string
  /**
   * The SNIP-20 this denomination wraps into, when this app knows one. Its
   * absence is what makes a voucher unwrappable — and unnameable, since the
   * decimal places come from the same entry.
   */
  token?: TokenInfo
  fiat?: number
}

export interface Balances {
  /** Native SCRT, in base units. The only thing on this chain that pays gas. */
  native?: string
  nativeFiat?: number
  /**
   * Every public denomination the account holds, keyed by denom — `uscrt` and
   * the `ibc/…` vouchers. Read without a permit, because none of it is private:
   * this is the half of the wallet an explorer can see too, and the half a wrap
   * spends.
   */
  bank: Map<string, string>
  /** The same holdings as rows, priced and with the zero denominations dropped. */
  publicBalances: PublicBalance[]
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
  const [bank, setBank] = useState<Map<string, string>>(new Map())
  const [publicBalances, setPublicBalances] = useState<PublicBalance[]>([])
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
    if (!address) return
    const timer = setInterval(refresh, REFRESH_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [address, refresh])

  useEffect(() => {
    if (!address || !client) {
      setNative(undefined)
      setBank(new Map())
      setPublicBalances([])
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
      const priceIds = [SCRT_PRICE_ID, ...allTokens().map((t) => t.coingeckoId).filter(Boolean)] as string[]

      const [bankResult, prices] = await Promise.all([
        // Every denomination in one read rather than `uscrt` alone: the public
        // vouchers sit in the same query, and the wallet has to show them for
        // the same reason it shows SCRT — they are the account's money, and
        // they are the ones that are not private yet.
        //
        // Caught by hand rather than with allSettled, so the reason survives
        // into a message instead of becoming an opaque rejected slot.
        queryAllBalances(client, address).catch((caught: unknown) => caught as Error),
        // Prices are decoration; a failure must not cost anyone their balances.
        fetchPrices(priceIds, currency.toLowerCase()).catch(() => new Map<string, number>())
      ])

      if (cancelled) return

      if (bankResult instanceof Error) {
        setError(bankResult.message)
        setNative(undefined)
        setBank(new Map())
        setPublicBalances([])
      } else {
        setBank(bankResult)
        // The bank module omits a zero balance rather than returning "0", and
        // here that absence really is zero: the query succeeded.
        setNative(bankResult.get(DENOM) ?? '0')
        setPublicBalances(
          [...bankResult]
            .filter(([, amount]) => BigInt(amount) > 0n)
            .map(([denom, amount]) => {
              const contract = tokenAddressForBankDenom(denom)
              const token = contract ? tokenByAddress(contract) : undefined
              const priceId = denom === DENOM ? SCRT_PRICE_ID : token?.coingeckoId
              return {
                denom,
                amount,
                token,
                fiat: priceId
                  ? fiatValue(amount, prices.get(priceId), denom === DENOM ? undefined : token?.decimals)
                  : undefined
              }
            })
        )
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
    bank,
    publicBalances,
    tokens,
    loading,
    error,
    scanning,
    scanProgress,
    refresh,
    scanAll
  }
}

import { useCallback, useEffect, useState } from 'react'

import { queryAllBalances } from '@/lib/bank'
import { hedged, mapWithLimit } from '@/lib/concurrency'
import { errorMessage } from '@/lib/errors'
import { fiatValue } from '@/lib/format'
import { fetchPrices } from '@/lib/prices'
import { queryBalance, type BalanceOutcome, type Snip20Auth } from '@/lib/snip20'
import { loadWatchlist, rememberTokens } from '@/lib/watchlist'
import { allTokenAddresses, allTokens, tokenByAddress, type TokenInfo } from '@/tokens/registry'
import { tokenAddressForBankDenom } from '@/tokens/routes'
import { DENOM } from '@/chains/secret4'
import { useSettings } from '@/store/settings'
import { queryClientPool, useWallet } from '@/store/wallet'

const CACHE_KEY = (address: string) => `secret-dashboard:balances:v1:${address}`

/**
 * The last balances read for an account, kept in this browser so the list is
 * there the moment the page opens instead of after a sweep. Amounts only, for
 * tokens that answered; the next read replaces them, and a token missing from
 * it is not carried over. Nothing leaves the device: this is what the wallet
 * screen already showed, stored where only this browser reads it.
 */
function cachedBalances(address: string): TokenBalance[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY(address))
    if (!raw) return []
    const entries = JSON.parse(raw) as Array<[string, string]>
    return entries.flatMap(([contract, amount]) => {
      const token = tokenByAddress(contract)
      return token ? [{ token, outcome: { status: 'ok' as const, amount } }] : []
    })
  } catch {
    return []
  }
}

/**
 * Keep what a read found. A watchlist read covers fewer tokens than a sweep,
 * so it updates the entries it read and keeps the others; a sweep replaces
 * the lot.
 */
function rememberBalances(address: string, rows: TokenBalance[], sweep: boolean): void {
  try {
    const read = new Map(
      rows.flatMap((row) =>
        row.outcome.status === 'ok' ? [[row.token.address, row.outcome.amount] as const] : []
      )
    )
    const kept = sweep
      ? new Map<string, string>()
      : new Map(
          cachedBalances(address).map((row) => [
            row.token.address,
            (row.outcome as { amount: string }).amount
          ])
        )
    for (const [contract, amount] of read) kept.set(contract, amount)
    localStorage.setItem(CACHE_KEY(address), JSON.stringify([...kept].filter(([, amount]) => amount !== '0')))
  } catch {
    // Only a head start.
  }
}

/** CoinGecko's id for SCRT itself. */
const SCRT_PRICE_ID = 'secret'

/**
 * How many contract reads run at once, per LCD.
 *
 * Measured on secret-4 (2026-09): the public LCDs speak HTTP/2, so the
 * browser's six-per-host limit does not apply and every read shares one
 * connection. A read takes 230–475 ms, nearly all of it the node running the
 * query in its enclave, so the sweep's length is how many rounds it takes —
 * 67 tokens six at a time was eleven rounds. Sixteen is four or five, and
 * still modest enough that a node does not start refusing.
 */
const QUERY_CONCURRENCY = 16

/**
 * A read still unanswered after this long is asked a second time, of another
 * node where there is one, and whichever answer comes first is used. Most
 * reads take a quarter of a second; a few took over two, and a sweep is only
 * as fast as its slowest read. The second request is only ever sent for those.
 */
const HEDGE_AFTER_MS = 1_000

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
export function useBalances(auth: Snip20Auth | undefined, owner?: string, contracts?: string[]): Balances {
  const walletAddress = useWallet((state) => state.address)
  const client = useWallet((state) => state.queryClient)
  const currency = useSettings((state) => state.currency)

  /*
   * Whose balances these are. Defaults to the connected wallet, which is what
   * every existing caller wants; a multisig passes its own address, because the
   * account being read and the account holding the screen are not the same
   * thing there.
   */
  const address = owner ?? walletAddress

  /*
   * The effect below depends on *which* authentication this is, not on the
   * object carrying it. A caller building `{kind:'viewing-key', …}` inline
   * would otherwise hand a new object every render and this would re-read the
   * whole registry forever — the kind of bug that only shows up as a node
   * politely rate-limiting somebody.
   */
  const pinned = contracts
  const pinnedKey = contracts?.join(',') ?? ''

  const authKey =
    auth === undefined
      ? 'none'
      : auth.kind === 'permit'
        ? `permit:${auth.permit.signature.signature}`
        : `key:${auth.address}:${auth.key}`

  const [native, setNative] = useState<string | undefined>()
  const [bank, setBank] = useState<Map<string, string>>(new Map())
  const [publicBalances, setPublicBalances] = useState<PublicBalance[]>([])
  const [scrtPrice, setScrtPrice] = useState<number | undefined>()
  const [tokens, setTokens] = useState<TokenBalance[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [scanning, setScanning] = useState(false)
  const [scanProgress, setScanProgress] = useState<[number, number]>([0, 0])
  /*
   * One read request: which turn it is, and whether that turn sweeps.
   *
   * Both in the same piece of state because they have to move together. While
   * the sweep was a separate latch it stayed on once set, so every periodic
   * refresh afterwards re-read all 96 contracts and the list sat at "Scanning"
   * every other minute. A sweep is a one-off; the request that asked for it
   * carries the flag, and the next request does not.
   *
   * The first request sweeps. Opening the app is exactly when the watchlist is
   * least trustworthy — a token may have arrived since the tab was last open,
   * and nothing else on screen would ever say so.
   */
  const [request, setRequest] = useState({ nonce: 0, sweep: true })
  const { sweep } = request

  const refresh = useCallback(() => setRequest((r) => ({ nonce: r.nonce + 1, sweep: false })), [])

  const scanAll = useCallback(() => setRequest((r) => ({ nonce: r.nonce + 1, sweep: true })), [])

  // Last visit's balances, on screen at once while this visit's read runs.
  useEffect(() => {
    if (!address || pinned || auth === undefined) return
    const cached = cachedBalances(address)
    if (cached.length > 0) setTokens((current) => (current.length > 0 ? current : cached))
    // Once per account; the read that follows replaces these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, authKey])

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
      setScanning(false)
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
      /*
       * Which tokens to ask about.
       *
       * A permit covers the whole registry, so a sweep is free to try every
       * contract and a watchlist keeps the ordinary refresh cheap. A viewing
       * key covers only the contracts it was actually set on — asking the
       * other ninety would fill the list with "unauthorized" rows that say
       * nothing except that no key was set there. So a caller reading with a
       * key passes exactly the contracts it has one for.
       */
      const contracts = pinned ?? (auth ? (sweep ? allTokenAddresses() : loadWatchlist(address)) : [])
      const priceIds = [
        SCRT_PRICE_ID,
        ...allTokens()
          .map((t) => t.coingeckoId)
          .filter(Boolean)
      ] as string[]

      const [bankResult, prices] = await Promise.all([
        // Every denomination in one read rather than `uscrt` alone: the public
        // vouchers sit in the same query, and the wallet has to show them for
        // the same reason it shows SCRT — they are the account's money, and
        // they are the ones that are not private yet.
        //
        // Caught by hand rather than with allSettled, so the reason survives
        // into a message instead of becoming an opaque rejected slot.
        //
        // Normalised into a real Error rather than cast to one. secretjs throws
        // the node's JSON body, which is not an Error — so `caught as Error`
        // was a lie the `instanceof` check below then believed, sending the
        // error object down the success path to have `.get()` called on it.
        queryAllBalances(client, address).catch((caught: unknown) => new Error(errorMessage(caught))),
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

      /*
       * Spread across every LCD that answers, a lane each: two providers finish
       * a sweep in about half the time one does. A read that is slow or fails
       * is asked again of the next node (`hedged`) before it counts as failed.
       */
      const pool = await queryClientPool()
      const lanes = pool.length > 0 ? pool : [client]
      let done = 0
      const outcomes = (
        await Promise.all(
          lanes.map((laneClient, lane) =>
            mapWithLimit(
              contracts.filter((_, index) => index % lanes.length === lane),
              QUERY_CONCURRENCY,
              async (contract) => {
                // The backup asks the next node along, or the same one again
                // when it is the only one — a slow answer is often one busy
                // backend behind a load balancer, not the whole provider.
                const backup = lanes[(lane + 1) % lanes.length]
                const outcome = await hedged(
                  () => queryBalance(laneClient, auth!, contract),
                  () => queryBalance(backup, auth!, contract),
                  HEDGE_AFTER_MS,
                  // A permit problem is an answer, not a slow node.
                  (answer) => answer.status !== 'error'
                )
                done += 1
                if (!cancelled && sweep) setScanProgress([done, contracts.length])
                return [contract, outcome] as const
              }
            )
          )
        )
      ).flat()

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

      // Anything with a balance is worth reading again next time without a
      // sweep — but only when this read was the registry-wide kind. A pinned
      // read knows less than the watchlist does and must not overwrite it.
      if (!pinned) {
        rememberTokens(address, held)
        rememberBalances(address, rows, sweep)
      }

      setTokens(rows)
      setLoading(false)
      setScanning(false)
    }

    void run()

    return () => {
      cancelled = true
    }
    // `request` is the refresh trigger, and says whether this one sweeps.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `authKey` stands in for `auth`; see above.
  }, [address, client, authKey, pinnedKey, currency, request, sweep])

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

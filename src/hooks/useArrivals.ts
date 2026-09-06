import { useEffect, useRef, useState } from 'react'

import { watchBankReceipts, type BankReceipt } from '@/lib/bankEvents'
import { resolveLcdUrl, resolveRpcUrl } from '@/lib/endpoint'
import { formatAmount } from '@/lib/format'
import type { Permit } from '@/lib/permit'
import { subscribeReceived, type Snip52Notification } from '@/lib/snip52'
import { loadWatchlist } from '@/lib/watchlist'
import { DENOM, DISPLAY_DENOM } from '@/chains/secret4'
import { SSCRT_ADDRESS, tokenByAddress, tokenImageUrl } from '@/tokens/registry'
import { useNotifications } from '@/store/notifications'
import { useSettings } from '@/store/settings'
import { useWallet } from '@/store/wallet'

/**
 * Whether push is actually working, so the UI can say so instead of implying
 * silence means nothing arrived.
 */
export type PushStatus =
  /** Turned off in Settings. Balances still refresh periodically. */
  | 'off'
  | 'connecting'
  /** Subscribed to at least one token. */
  | 'live'
  /** Could not subscribe to anything; the periodic refresh is doing the work. */
  | 'unavailable'

interface Options {
  /** Called whenever something arrives, so balances can be re-read. */
  onArrival?: () => void
}

/**
 * Tell the user when something arrives, private or public.
 *
 * Push is an optimisation, never the source of truth. A WebSocket can die
 * quietly, a node can drop a subscription, and a token may have no channels at
 * all — so balances are also refreshed on a slow timer regardless. This makes
 * arrivals appear immediately; it does not make them appear *at all*.
 */
export function useArrivals(permit: Permit | undefined, { onArrival }: Options = {}) {
  const address = useWallet((state) => state.address)
  const enabled = useSettings((state) => state.notificationsEnabled)
  const lcdOverride = useSettings((state) => state.lcdOverride)
  const rpcOverride = useSettings((state) => state.rpcOverride)
  const push = useNotifications((state) => state.push)

  const [status, setStatus] = useState<PushStatus>('off')
  const [liveCount, setLiveCount] = useState(0)

  // Held in a ref so a changing callback identity does not tear down every
  // subscription and rebuild it.
  const arrival = useRef(onArrival)
  arrival.current = onArrival

  useEffect(() => {
    // A permit is needed only for the private half. Public receipts are readable
    // by anyone, so somebody who has not signed one still hears about arriving
    // SCRT — which is often the very first thing that happens to a new account.
    if (!enabled || !address) {
      setStatus('off')
      setLiveCount(0)
      return
    }

    let cancelled = false
    const unsubscribes: Array<() => void> = []
    setStatus('connecting')

    const handle = (notification: Snip52Notification) => {
      const token = tokenByAddress(notification.contractAddress)
      push({
        kind: 'received-private',
        symbol: token?.symbol,
        image: token ? tokenImageUrl(token) : undefined,
        amount: notification.amount
          ? formatAmount(notification.amount, { decimals: token?.decimals ?? 6 })
          : undefined
      })
      arrival.current?.()
    }

    /*
     * A public token landing on Secret is readable by anyone, so this is the
     * moment to offer wrapping it. SCRT has a known destination (sSCRT); an IBC
     * voucher does not until the bridge registry lands, so it is reported
     * without a wrap target rather than with a guessed one.
     */
    const handleBank = (receipt: BankReceipt) => {
      const isNative = receipt.denom === DENOM

      push({
        kind: 'received-public',
        symbol: isNative ? DISPLAY_DENOM : shortDenom(receipt.denom),
        /*
         * An IBC voucher's decimal places are not knowable from the denom
         * alone, and the mapping arrives with the bridge registry in phase 6.
         * Until then an unknown denom is announced without a figure: a toast
         * reading "150" when the real amount is 0.00015 is worse than one that
         * simply says something arrived.
         */
        amount: isNative ? formatAmount(receipt.amount) : undefined,
        wrapContract: isNative ? SSCRT_ADDRESS : undefined
      })
      arrival.current?.()
    }

    const run = async () => {
      try {
        const [rpcUrl, lcdUrl] = await Promise.all([resolveRpcUrl(rpcOverride), resolveLcdUrl(lcdOverride)])
        if (cancelled) return

        const contracts = permit ? loadWatchlist(address) : []

        // Settled, not raced: a token with no channels, or one whose contract
        // will not answer, must not stop the others from subscribing.
        const results = await Promise.allSettled(
          contracts.map((contractAddress) =>
            subscribeReceived({
              rpcUrl,
              lcdUrl,
              contractAddress,
              permit: permit!,
              onNotification: handle
            })
          )
        )

        if (cancelled) {
          for (const result of results) {
            if (result.status === 'fulfilled') result.value()
          }
          return
        }

        // Public receipts need no permit and no channels, so this is watched
        // whether or not any SNIP-20 subscription succeeded.
        let publicLive = false
        try {
          unsubscribes.push(await watchBankReceipts({ rpcUrl, address, onReceipt: handleBank }))
          publicLive = true
        } catch {
          /* the periodic refresh still covers it */
        }

        let live = 0
        for (const result of results) {
          if (result.status === 'fulfilled') {
            unsubscribes.push(result.value)
            live += 1
          }
        }

        setLiveCount(live)
        // Watching anything at all counts as live; the indicator answers
        // "will I be told immediately?", not "how many sockets are open?".
        setStatus(live > 0 || publicLive ? 'live' : 'unavailable')
      } catch {
        // Endpoint resolution failed, or neutrino could not load. Not fatal:
        // the periodic refresh still keeps balances honest.
        if (!cancelled) {
          setStatus('unavailable')
          setLiveCount(0)
        }
      }
    }

    void run()

    return () => {
      cancelled = true
      // An orphaned subscription keeps a WebSocket listener alive for the life
      // of the page, so every one of these has to be called.
      for (const unsubscribe of unsubscribes) {
        try {
          unsubscribe()
        } catch {
          /* already gone */
        }
      }
    }
  }, [enabled, permit, address, rpcOverride, lcdOverride, push])

  return { status, liveCount }
}

/** `ibc/0954E1C2…` is not a name anyone reads; show enough to recognise it. */
function shortDenom(denom: string): string {
  if (!denom.startsWith('ibc/')) return denom
  return `IBC ${denom.slice(4, 10)}…`
}

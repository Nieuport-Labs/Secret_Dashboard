import { useCallback, useEffect, useState } from 'react'

import { summarisePublicTransfers, type ActivityEntry } from '@/lib/activity'
import { mapWithLimit } from '@/lib/concurrency'
import { resolveLcdUrl } from '@/lib/endpoint'
import type { Permit } from '@/lib/permit'
import { queryPublicTransfers } from '@/lib/publicHistory'
import { queryTransferHistory } from '@/lib/snip20'
import { loadWatchlist } from '@/lib/watchlist'
import { privateSymbol, tokenByAddress } from '@/tokens/registry'
import { useSettings } from '@/store/settings'
import { useWallet } from '@/store/wallet'

export type { ActivityEntry, ActivityKind } from '@/lib/activity'

/**
 * What happened, from both halves of the account.
 *
 * A Secret wallet holds two kinds of balance and so has two kinds of history,
 * kept in completely different places: SNIP-20 movements are encrypted in
 * contract state and need the permit to read, while `uscrt` and the `ibc/…`
 * vouchers move through the bank module in public and are read from the chain's
 * transaction index. Neither is the whole picture. This merges them into one
 * list, ordered by when things actually happened, and marks which half each
 * entry came from — because that distinction is the entire point of this chain
 * and hiding it would be the wrong kind of tidy.
 *
 * The two reads are independent on purpose: no permit still gives a full public
 * history, and an unreachable transaction index still leaves the private half.
 */
export function useActivity(permit: Permit | undefined, pageSize = 12) {
  const address = useWallet((state) => state.address)
  const client = useWallet((state) => state.queryClient)
  const lcdOverride = useSettings((state) => state.lcdOverride)

  const [entries, setEntries] = useState<ActivityEntry[]>([])
  const [loading, setLoading] = useState(false)
  /** Tokens whose private history could not be read. Not the same as having none. */
  const [unreadable, setUnreadable] = useState(0)
  /** Set when the public half could not be read at all. */
  const [publicError, setPublicError] = useState<string | undefined>()
  const [nonce, setNonce] = useState(0)

  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    if (!address || !client) {
      setEntries([])
      return
    }

    let cancelled = false
    setLoading(true)

    const readPrivate = async (): Promise<{ entries: ActivityEntry[]; failed: number }> => {
      if (!permit) return { entries: [], failed: 0 }

      const perToken = await mapWithLimit(loadWatchlist(address), 4, async (contract) => {
        try {
          return { contract, txs: await queryTransferHistory(client, permit, contract, { pageSize }) }
        } catch {
          return { contract, txs: undefined }
        }
      })

      const found: ActivityEntry[] = []
      let failed = 0

      for (const { contract, txs } of perToken) {
        if (!txs) {
          failed += 1
          continue
        }
        const token = tokenByAddress(contract)
        if (!token) continue

        for (const transfer of txs) {
          const incoming = transfer.receiver === address
          found.push({
            id: `snip20:${contract}:${transfer.id ?? `${transfer.block_time}-${transfer.coins.amount}`}`,
            kind: incoming ? 'received-private' : 'sent-private',
            private: true,
            token,
            symbol: privateSymbol(token),
            decimals: token.decimals,
            amount: transfer.coins.amount,
            counterparty: incoming ? transfer.sender : transfer.receiver,
            at: transfer.block_time
          })
        }
      }

      return { entries: found, failed }
    }

    const readPublic = async (): Promise<ActivityEntry[]> => {
      const lcdUrl = await resolveLcdUrl(lcdOverride)
      return summarisePublicTransfers(await queryPublicTransfers(lcdUrl, address, pageSize * 2))
    }

    const run = async () => {
      const [privateResult, publicResult] = await Promise.all([
        readPrivate(),
        readPublic().catch((caught: unknown) => caught as Error)
      ])

      if (cancelled) return

      const merged = [...privateResult.entries]

      if (publicResult instanceof Error) {
        setPublicError(publicResult.message)
      } else {
        setPublicError(undefined)
        merged.push(...publicResult)
      }

      // Newest first. Entries without a timestamp sort to the end rather than
      // claiming to be from 1970.
      merged.sort((a, b) => (b.at ?? 0) - (a.at ?? 0))

      setEntries(merged.slice(0, pageSize * 2))
      setUnreadable(privateResult.failed)
      setLoading(false)
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [address, client, permit, pageSize, lcdOverride, nonce])

  return { entries, loading, unreadable, publicError, refresh }
}

import { useEffect, useState } from 'react'

import { mapWithLimit } from '@/lib/concurrency'
import type { Permit } from '@/lib/permit'
import { queryTransferHistory, type Transfer } from '@/lib/snip20'
import { loadWatchlist } from '@/lib/watchlist'
import { tokenByAddress, type TokenInfo } from '@/tokens/registry'
import { useWallet } from '@/store/wallet'

export interface HistoryEntry {
  token: TokenInfo
  transfer: Transfer
  /** Which way the tokens moved, from this account's point of view. */
  direction: 'in' | 'out' | 'self'
  /** Seconds since the epoch. Absent on contracts that do not record it. */
  at?: number
}

/**
 * Private transfer history across the account's watched tokens.
 *
 * This is the half of a SNIP-20 that only a permit can reach: the transfers are
 * encrypted in contract state, so no explorer shows them. Public SCRT movements
 * are a different thing entirely and belong to the bank module.
 */
export function useTransferHistory(permit: Permit | undefined, pageSize = 10) {
  const address = useWallet((state) => state.address)
  const client = useWallet((state) => state.queryClient)

  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [loading, setLoading] = useState(false)
  /** Tokens whose history could not be read. Not the same as having none. */
  const [unreadable, setUnreadable] = useState(0)

  useEffect(() => {
    if (!address || !client || !permit) {
      setEntries([])
      return
    }

    let cancelled = false
    setLoading(true)

    const run = async () => {
      const contracts = loadWatchlist(address)

      const perToken = await mapWithLimit(contracts, 4, async (contract) => {
        try {
          return { contract, txs: await queryTransferHistory(client, permit, contract, { pageSize }) }
        } catch {
          return { contract, txs: undefined }
        }
      })

      if (cancelled) return

      const merged: HistoryEntry[] = []
      let failed = 0

      for (const { contract, txs } of perToken) {
        if (!txs) {
          failed += 1
          continue
        }
        const token = tokenByAddress(contract)
        if (!token) continue

        for (const transfer of txs) {
          merged.push({
            token,
            transfer,
            direction:
              transfer.receiver === address && transfer.from === address
                ? 'self'
                : transfer.receiver === address
                  ? 'in'
                  : 'out',
            at: transfer.block_time
          })
        }
      }

      // Newest first. Contracts that omit block_time sort to the end rather
      // than claiming to be from 1970.
      merged.sort((a, b) => (b.at ?? 0) - (a.at ?? 0))

      setEntries(merged.slice(0, pageSize * 2))
      setUnreadable(failed)
      setLoading(false)
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [address, client, permit, pageSize])

  return { entries, loading, unreadable }
}

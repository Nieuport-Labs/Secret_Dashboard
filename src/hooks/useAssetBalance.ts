import { useCallback, useEffect, useState } from 'react'

import { queryNativeBalance } from '@/lib/bank'
import { errorMessage } from '@/lib/errors'
import type { InvoiceAsset } from '@/lib/invoice'
import { permitAuth, queryBalance } from '@/lib/snip20'
import { usePermit } from '@/hooks/usePermit'
import { useWallet } from '@/store/wallet'

export type AssetBalance =
  | { status: 'loading' }
  | { status: 'ok'; amount: string }
  /** A private balance, and no permit covering it has been signed yet. */
  | { status: 'needs-permit' }
  | { status: 'error'; message: string }

/**
 * The connected account's balance of one asset, and nothing else.
 *
 * For a screen that is about a single asset — paying an invoice. `useBalances`
 * reads the whole account and, without a full sweep, only the SNIP-20s on the
 * account's watchlist; an invoice is often for a token the payer has never
 * held, so it was never on that list and came back unreadable. Asking for the
 * one contract directly is both faster and the only read that answers.
 *
 * Public assets need nothing but the address. A private one needs the query
 * permit, and when there is none this says so rather than guessing, so the
 * screen can offer to sign one.
 */
export function useAssetBalance(asset: InvoiceAsset | undefined) {
  const address = useWallet((state) => state.address)
  const client = useWallet((state) => state.queryClient)
  const { permit, sign, signing } = usePermit()

  const [balance, setBalance] = useState<AssetBalance>({ status: 'loading' })
  const [request, setRequest] = useState(0)

  const refresh = useCallback(() => setRequest((current) => current + 1), [])

  // Keyed on the asset's id, not the object: callers rebuild it every render.
  const assetId = asset?.id
  const isPrivate = asset?.private ?? false

  useEffect(() => {
    if (!assetId || !address || !client) return
    let cancelled = false
    setBalance({ status: 'loading' })

    const run = async (): Promise<AssetBalance> => {
      if (!isPrivate) return { status: 'ok', amount: await queryNativeBalance(client, address, assetId) }
      if (!permit) return { status: 'needs-permit' }
      const outcome = await queryBalance(client, permitAuth(permit), assetId)
      if (outcome.status === 'ok') return { status: 'ok', amount: outcome.amount }
      if (outcome.status === 'not-covered') return { status: 'needs-permit' }
      return { status: 'error', message: outcome.message }
    }

    run()
      .then((next) => {
        if (!cancelled) setBalance(next)
      })
      .catch((caught: unknown) => {
        if (!cancelled) setBalance({ status: 'error', message: errorMessage(caught) })
      })

    return () => {
      cancelled = true
    }
  }, [assetId, isPrivate, address, client, permit, request])

  return { balance, refresh, signPermit: sign, signing }
}

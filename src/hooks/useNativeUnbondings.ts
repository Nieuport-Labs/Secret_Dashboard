import { useCallback, useEffect, useState } from 'react'

import { errorMessage } from '@/lib/errors'
import { queryUnbondings, queryUnbondingSeconds, queryValidators } from '@/lib/staking'
import { useWallet } from '@/store/wallet'

export interface NativeUnbonding {
  /** Base units of SCRT. */
  amount: string
  /** When the chain releases it. */
  at: Date
  validatorAddress: string
  /** Absent until the validator list has been read. */
  moniker?: string
}

export interface NativeUnbondings {
  entries: NativeUnbonding[]
  /** Base units still working through the queue. */
  total: string
  /** The chain's unbonding period, for drawing how far along each one is. */
  unbondingSeconds: number
  loading: boolean
  error?: string
  refresh: () => void
}

/**
 * Plain SCRT on its way back from a validator.
 *
 * The same shape of thing as the stkd-SCRT queue and invisible for the same
 * reason: an undelegating balance belongs to no account until the day it lands,
 * so it appears in no balance anywhere and the wallet used to say you held
 * nothing. The staking screen shows these, but only if you think to go and
 * look — and the one place nobody thinks to look for missing money is the
 * screen that is telling them it does not exist.
 *
 * Public queries, all three: this needs no permit, unlike its private cousin.
 * The validator list is fetched only when there is something to name.
 */
export function useNativeUnbondings(): NativeUnbondings {
  const address = useWallet((state) => state.address)
  const client = useWallet((state) => state.queryClient)

  const [entries, setEntries] = useState<NativeUnbonding[]>([])
  const [unbondingSeconds, setUnbondingSeconds] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [nonce, setNonce] = useState(0)

  const refresh = useCallback(() => setNonce((value) => value + 1), [])

  useEffect(() => {
    if (!address || !client) {
      setEntries([])
      return
    }

    let cancelled = false
    setLoading(true)

    const run = async () => {
      try {
        const [rows, seconds] = await Promise.all([
          queryUnbondings(client, address),
          queryUnbondingSeconds(client).catch(() => 0)
        ])
        if (cancelled) return

        setEntries(rows.map((row) => ({ ...row, at: row.completesAt })))
        setUnbondingSeconds(seconds)
        setError(undefined)

        // Only now, and only if it is worth anything: this is every bonded
        // validator on the chain, fetched to turn a valoper address into a name.
        if (rows.length > 0) {
          const validators = await queryValidators(client).catch(() => [])
          if (cancelled || validators.length === 0) return
          const names = new Map(validators.map((v) => [v.address, v.moniker]))
          setEntries((current) =>
            current.map((row) => ({ ...row, moniker: names.get(row.validatorAddress) }))
          )
        }
      } catch (caught) {
        if (!cancelled) {
          setEntries([])
          setError(errorMessage(caught))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [address, client, nonce])

  return {
    entries,
    total: entries.reduce((sum, row) => sum + BigInt(row.amount), 0n).toString(),
    unbondingSeconds,
    loading,
    error,
    refresh
  }
}

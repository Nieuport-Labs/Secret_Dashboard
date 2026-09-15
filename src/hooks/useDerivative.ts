import { useCallback, useEffect, useState } from 'react'

import {
  PermitRefused,
  queryDerivativeInfo,
  queryDerivativeQueue,
  sumAmounts,
  type DerivativeQueue,
  type NextBatch,
  type DerivativeInfo,
  type DerivativeUnbonding
} from '@/lib/derivative'
import { errorMessage } from '@/lib/errors'
import type { Permit } from '@/lib/permit'
import { useWallet } from '@/store/wallet'

export interface Derivative {
  /** Public facts about the contract; present before any permit is signed. */
  info?: DerivativeInfo
  /** The account's queue, oldest request first. */
  unbondings: DerivativeUnbonding[]
  /** Base units of SCRT `claim` would pay out now. */
  claimable: string
  /** Base units of SCRT still working through the queue, the next batch included. */
  unbondingTotal: string
  /** Asked for but not yet sent; it leaves with the next batch. */
  nextBatch: NextBatch
  loading: boolean
  /** The permit cannot read the queue. Signing again is the fix, so say so. */
  needsPermit: boolean
  error?: string
  refresh: () => void
}

/**
 * The account's position in Shade's staking derivative.
 *
 * Read for every connected account rather than only for the ones holding
 * stkd-SCRT, because the two states this exists to show — SCRT unbonding, and
 * SCRT ready to claim — both outlive the balance. Someone who unbonded the lot
 * holds no stkd-SCRT at all and is precisely the person who needs to be told
 * their money is on its way back.
 *
 * One query is public and one needs a permit; a failure of either is kept to
 * itself, since the public price is still worth having when the queue is not
 * readable and vice versa.
 *
 * The permit here is *not* the registry-wide one. This contract's permission
 * vocabulary is its own — see `STAKING_SCOPE` — so the queue is read with a
 * permit signed for it alone, and an account that has never had a position is
 * never asked for that signature.
 */
export function useDerivative(permit: Permit | undefined): Derivative {
  const address = useWallet((state) => state.address)
  const client = useWallet((state) => state.queryClient)

  const [info, setInfo] = useState<DerivativeInfo | undefined>()
  const [unbondings, setUnbondings] = useState<DerivativeUnbonding[]>([])
  const [claimable, setClaimable] = useState('0')
  const [unbondingTotal, setUnbondingTotal] = useState('0')
  const [nextBatch, setNextBatch] = useState<NextBatch>({ amount: '0' })
  const [loading, setLoading] = useState(false)
  const [needsPermit, setNeedsPermit] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [nonce, setNonce] = useState(0)

  const refresh = useCallback(() => setNonce((value) => value + 1), [])

  useEffect(() => {
    if (!client) return

    let cancelled = false
    setLoading(true)

    const run = async () => {
      const readable = Boolean(address && permit)

      const [infoResult, queue] = await Promise.all([
        queryDerivativeInfo(client).catch((caught: unknown) => new Error(errorMessage(caught))),
        readable
          ? queryDerivativeQueue(client, permit!).catch((caught: unknown) => caught as Error)
          : ({ entries: [], claimable: '0', nextBatch: { amount: '0' } } satisfies DerivativeQueue)
      ])

      if (cancelled) return

      setInfo(infoResult instanceof Error ? undefined : infoResult)

      // Nothing was asked, so nothing was refused — but the queue is still
      // unread, and the screen has to be able to say which of the two it is.
      if (!readable) {
        setUnbondings([])
        setClaimable('0')
        setUnbondingTotal('0')
        setNextBatch({ amount: '0' })
        setNeedsPermit(Boolean(address))
        setError(undefined)
      } else if (!(queue instanceof Error)) {
        setUnbondings(queue.entries)
        setClaimable(queue.claimable)
        // What is on its way is both what has left and what is about to: the
        // figure on the row has to match what the rows beneath it add up to.
        setUnbondingTotal(
          sumAmounts([...queue.entries.filter((row) => !row.mature), { ...queue.nextBatch, mature: false }])
        )
        setNextBatch(queue.nextBatch)
        setNeedsPermit(false)
        setError(undefined)
      } else {
        setUnbondings([])
        setClaimable('0')
        setUnbondingTotal('0')
        setNextBatch({ amount: '0' })
        setNeedsPermit(queue instanceof PermitRefused)
        setError(queue instanceof PermitRefused ? undefined : errorMessage(queue))
      }

      setLoading(false)
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [address, client, permit, nonce])

  // A disconnected account has no queue; leaving the last one on screen would
  // show one person's unbondings to the next.
  useEffect(() => {
    if (address) return
    setUnbondings([])
    setClaimable('0')
    setUnbondingTotal('0')
    setNextBatch({ amount: '0' })
    setNeedsPermit(false)
  }, [address])

  return {
    info,
    unbondings,
    claimable,
    unbondingTotal,
    nextBatch,
    loading,
    needsPermit,
    error,
    refresh
  }
}

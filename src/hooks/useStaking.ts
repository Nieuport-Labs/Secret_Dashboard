import { useCallback, useEffect, useState } from 'react'

import { resolveLcdUrl } from '@/lib/endpoint'
import {
  queryDelegations,
  queryRestakeEntries,
  queryRestakeThreshold,
  queryRewards,
  queryStakingApr,
  queryUnbondings,
  queryUnbondingSeconds,
  queryValidator,
  queryValidators,
  type Delegation,
  type Reward,
  type Unbonding,
  type Validator
} from '@/lib/staking'
import { errorMessage } from '@/lib/errors'
import { useSettings } from '@/store/settings'
import { useWallet } from '@/store/wallet'

export interface StakingData {
  validators: Validator[]
  delegations: Map<string, Delegation>
  rewards: Map<string, Reward>
  unbondings: Unbonding[]
  /** Validators with auto-restake switched on. */
  restaking: Set<string>
  /** Minimum delegation the chain will auto-restake, in base units. */
  restakeThreshold?: string
  unbondingSeconds: number
  /** All pending rewards, in base units. */
  totalRewards: string
  /** Everything currently delegated, in base units. */
  totalStaked: string
  /** Annualised staking return, as a fraction (0.05 = 5%). Undefined if any of
   *  the chain facts it is derived from could not be read. */
  apr?: number
  loading: boolean
  error?: string
  refresh: () => void
}

/**
 * Everything the staking screen needs, in one read.
 *
 * The validator list is public and loads without a wallet; the rest is
 * per-account and only fetched once there is one. Both go together because a
 * validator row shows what you have with it, and splitting the two produces a
 * list that visibly rearranges itself after the fact.
 */
export function useStaking(): StakingData {
  const address = useWallet((state) => state.address)
  const client = useWallet((state) => state.queryClient)
  const lcdOverride = useSettings((state) => state.lcdOverride)

  const [validators, setValidators] = useState<Validator[]>([])
  const [delegations, setDelegations] = useState<Map<string, Delegation>>(new Map())
  const [rewards, setRewards] = useState<Map<string, Reward>>(new Map())
  const [unbondings, setUnbondings] = useState<Unbonding[]>([])
  const [restaking, setRestaking] = useState<Set<string>>(new Set())
  const [restakeThreshold, setRestakeThreshold] = useState<string | undefined>()
  const [unbondingSeconds, setUnbondingSeconds] = useState(0)
  const [apr, setApr] = useState<number | undefined>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [nonce, setNonce] = useState(0)

  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    if (!client) return

    let cancelled = false
    setLoading(true)
    setError(undefined)

    const run = async () => {
      try {
        const [vals, threshold, unbondSeconds] = await Promise.all([
          queryValidators(client),
          // A failure here must not blank the screen; it only means the floor
          // cannot be shown, so the toggle is offered with a caveat instead.
          queryRestakeThreshold(client).catch(() => undefined),
          queryUnbondingSeconds(client).catch(() => 0)
        ])

        // Decoration, not a blocker: the summary bar shows "Unavailable"
        // rather than holding up the validator list over a third figure.
        void resolveLcdUrl(lcdOverride)
          .then(queryStakingApr)
          .then((value) => {
            if (!cancelled) setApr(value)
          })
          .catch(() => {
            if (!cancelled) setApr(undefined)
          })

        if (cancelled) return
        setValidators(vals)
        setRestakeThreshold(threshold)
        setUnbondingSeconds(unbondSeconds)

        if (!address) {
          setDelegations(new Map())
          setRewards(new Map())
          setUnbondings([])
          setRestaking(new Set())
          setLoading(false)
          return
        }

        const [dels, rews, unbs, entries] = await Promise.all([
          queryDelegations(client, address),
          queryRewards(client, address).catch(() => []),
          queryUnbondings(client, address).catch(() => []),
          queryRestakeEntries(client, address).catch(() => [])
        ])

        if (cancelled) return

        // A delegation outlives its validator's place in the active set. Fetch
        // any we stake with that the bonded list did not include, so a stake
        // with a jailed or unbonded validator stays visible and movable.
        const known = new Set(vals.map((v) => v.address))
        const missing = dels.map((d) => d.validatorAddress).filter((a) => !known.has(a))
        if (missing.length > 0) {
          const extra = (await Promise.all(missing.map((a) => queryValidator(client, a)))).filter(
            (v) => v !== undefined
          )
          if (!cancelled && extra.length > 0) setValidators([...vals, ...extra])
        }

        setDelegations(new Map(dels.map((d) => [d.validatorAddress, d])))
        setRewards(new Map(rews.map((r) => [r.validatorAddress, r])))
        setUnbondings(unbs)
        setRestaking(new Set(entries))
        setLoading(false)
      } catch (caught) {
        if (cancelled) return
        setError(errorMessage(caught))
        setLoading(false)
      }
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [client, address, lcdOverride, nonce])

  const sum = (values: Iterable<{ amount: string }>) => {
    let total = 0n
    for (const item of values) total += BigInt(item.amount)
    return total.toString()
  }

  return {
    validators,
    delegations,
    rewards,
    unbondings,
    restaking,
    restakeThreshold,
    unbondingSeconds,
    totalRewards: sum(rewards.values()),
    totalStaked: sum(delegations.values()),
    apr,
    loading,
    error,
    refresh
  }
}

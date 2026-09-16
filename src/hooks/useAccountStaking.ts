import { useEffect, useState } from 'react'

import {
  queryDelegations,
  queryRewards,
  queryValidators,
  type Delegation,
  type Reward,
  type Validator
} from '@/lib/staking'
import { useWallet } from '@/store/wallet'

/**
 * The staking picture for any account, not just the connected one.
 *
 * `useStaking` answers the same questions for the wallet and is wired to it
 * throughout — which is right for the staking screen and useless for a
 * multisig, where the account being staked is not the account holding the
 * screen. Rather than thread an override through that hook and its six
 * consumers, this reads the three things a proposal form needs.
 *
 * All of it is public chain state, so it needs no permit and works while
 * nobody is connected at all.
 */

export interface AccountStaking {
  /** Every bonded validator, for choosing one to stake with. */
  validators: Validator[]
  /** What this account has staked, by validator address. */
  delegations: Map<string, Delegation>
  /** What it has earned and not claimed, by validator address. */
  rewards: Map<string, Reward>
  loading: boolean
}

export function useAccountStaking(address: string | undefined): AccountStaking {
  const client = useWallet((state) => state.queryClient)

  const [validators, setValidators] = useState<Validator[]>([])
  const [delegations, setDelegations] = useState<Map<string, Delegation>>(new Map())
  const [rewards, setRewards] = useState<Map<string, Reward>>(new Map())
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!client) return

    let cancelled = false
    setLoading(true)

    const run = async () => {
      // Settled rather than raced: a delegation read that fails must not cost
      // the validator list, which is what most of the forms actually need.
      const [list, delegated, earned] = await Promise.all([
        queryValidators(client).catch(() => [] as Validator[]),
        address ? queryDelegations(client, address).catch(() => [] as Delegation[]) : Promise.resolve([]),
        address ? queryRewards(client, address).catch(() => [] as Reward[]) : Promise.resolve([])
      ])

      if (cancelled) return
      setValidators(list)
      setDelegations(new Map(delegated.map((entry) => [entry.validatorAddress, entry])))
      setRewards(new Map(earned.map((entry) => [entry.validatorAddress, entry])))
      setLoading(false)
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [client, address])

  return { validators, delegations, rewards, loading }
}

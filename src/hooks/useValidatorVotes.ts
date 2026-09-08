import { useCallback, useEffect, useRef, useState } from 'react'

import { BECH32_PREFIX } from '@/chains/secret4'
import { errorMessage } from '@/lib/errors'
import { queryProposalVotes, type VoteOption } from '@/lib/governance'
import { queryValidators, type Validator } from '@/lib/staking'
import { useWallet } from '@/store/wallet'

export interface ValidatorVote {
  validator: Validator
  option?: VoteOption
}

export interface ValidatorVotesData {
  votes: ValidatorVote[]
  loading: boolean
  error?: string
  refresh: () => void
}

/**
 * How every bonded validator voted on one proposal.
 *
 * The chain records a vote against the account that signed it, not against a
 * validator — so matching one to a validator means converting each
 * operator's `secretvaloper…` address to the account address it shares with
 * its self-delegator, the same bytes spelled with the `secret` prefix.
 * secretjs carries this conversion (`validatorAddressToSelfDelegatorAddress`)
 * since it is exactly the inverse of the one already used elsewhere in this
 * app to go from a self-delegator to their validator address.
 *
 * `enabled` should be the proposal's own open/closed state: once a proposal
 * is tallied the chain prunes its votes, so asking here would only ever come
 * back empty and report every validator as silent.
 */
export function useValidatorVotes(id: string | undefined, enabled: boolean): ValidatorVotesData {
  const client = useWallet((state) => state.queryClient)

  const [votes, setVotes] = useState<ValidatorVote[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [nonce, setNonce] = useState(0)

  const generation = useRef(0)
  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    if (!client || !id || !enabled) return

    generation.current += 1
    const mine = generation.current
    const current = () => generation.current === mine

    setLoading(true)
    setError(undefined)

    const run = async () => {
      try {
        const [validators, ballots, secretjs] = await Promise.all([
          queryValidators(client),
          queryProposalVotes(client, id),
          import('secretjs')
        ])
        if (!current()) return

        setVotes(
          validators.map((validator) => ({
            validator,
            option: ballots.get(
              secretjs.validatorAddressToSelfDelegatorAddress(validator.address, BECH32_PREFIX)
            )
          }))
        )
        setLoading(false)
      } catch (caught) {
        if (!current()) return
        setError(errorMessage(caught))
        setLoading(false)
      }
    }

    void run()

    return () => {
      generation.current += 1
    }
  }, [client, id, enabled, nonce])

  return { votes, loading, error, refresh }
}

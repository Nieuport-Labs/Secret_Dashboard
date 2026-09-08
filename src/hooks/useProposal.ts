import { useCallback, useEffect, useRef, useState } from 'react'

import { loadLiveState } from '@/hooks/useGovernance'
import { errorMessage, isNotFound } from '@/lib/errors'
import {
  queryBondedTokens,
  queryGovParams,
  queryProposal,
  type GovParams,
  type Proposal,
  type Tally,
  type VoteOption
} from '@/lib/governance'
import { useWallet } from '@/store/wallet'

export interface ProposalData {
  proposal?: Proposal
  tally?: Tally
  myVote?: VoteOption
  params?: GovParams
  bondedTokens: bigint
  loading: boolean
  /** The proposal id does not exist on chain, as opposed to failing to load. */
  notFound: boolean
  error?: string
  refresh: () => void
}

/**
 * One proposal and everything needed to read and vote on it.
 *
 * Queried on its own rather than picked out of the list, so that a link
 * straight to `/governance/372` — pasted, bookmarked, or opened in a new tab —
 * loads that one proposal instead of first pulling the entire history down to
 * find it.
 */
export function useProposal(id: string | undefined): ProposalData {
  const client = useWallet((state) => state.queryClient)
  const address = useWallet((state) => state.address)

  const [proposal, setProposal] = useState<Proposal | undefined>()
  const [tally, setTally] = useState<Tally | undefined>()
  const [myVote, setMyVote] = useState<VoteOption | undefined>()
  const [params, setParams] = useState<GovParams | undefined>()
  const [bondedTokens, setBondedTokens] = useState(0n)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [nonce, setNonce] = useState(0)

  const generation = useRef(0)

  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    if (!client || !id) return

    generation.current += 1
    const mine = generation.current
    const current = () => generation.current === mine

    setLoading(true)
    setError(undefined)
    setNotFound(false)

    const run = async () => {
      try {
        const [found, chainParams, bonded] = await Promise.all([
          queryProposal(client, id),
          queryGovParams(client).catch(() => undefined),
          queryBondedTokens(client).catch(() => 0n)
        ])

        if (!current()) return

        if (!found) {
          setNotFound(true)
          setLoading(false)
          return
        }

        setProposal(found)
        if (chainParams) setParams(chainParams)
        setBondedTokens(bonded)
        setLoading(false)

        const live = await loadLiveState(client, [found], address)
        if (!current()) return
        setTally(live.tallies.get(found.id))
        setMyVote(live.myVotes.get(found.id))
      } catch (caught) {
        if (!current()) return
        /*
         * The chain answers an unknown proposal id with an error rather than an
         * empty result, so "does not exist" and "could not be read" arrive the
         * same way and have to be told apart. Getting it wrong shows a network
         * blip as a missing proposal, or the other way round.
         */
        if (isNotFound(caught)) setNotFound(true)
        else setError(errorMessage(caught))
        setLoading(false)
      }
    }

    void run()

    return () => {
      generation.current += 1
    }
  }, [client, id, address, nonce])

  return { proposal, tally, myVote, params, bondedTokens, loading, notFound, error, refresh }
}

import { useCallback, useEffect, useRef, useState } from 'react'
import type { SecretNetworkClient } from 'secretjs'

import { errorMessage } from '@/lib/errors'
import {
  queryAllProposals,
  queryBondedTokens,
  queryGovParams,
  queryMyVote,
  queryTally,
  type GovParams,
  type Proposal,
  type Tally,
  type VoteOption
} from '@/lib/governance'
import { useActingAddress } from '@/store/accounts'
import { useWallet } from '@/store/wallet'

export interface GovernanceData {
  /** The chain's whole history, newest first. Filtering happens in the page. */
  proposals: Proposal[]
  params?: GovParams
  /** Everything staked, which is what quorum is measured against. */
  bondedTokens: bigint
  /** Live counts for proposals still open, keyed by proposal id. */
  tallies: Map<string, Tally>
  /** How the connected account voted, for proposals still open. */
  myVotes: Map<string, VoteOption>
  loading: boolean
  error?: string
  refresh: () => void
}

/**
 * Live counts and this account's votes, for whichever proposals are still open.
 *
 * Only the open ones: a closed proposal already carries the tally the chain
 * acted on, and its votes have been pruned from state, so asking would be a
 * request per row for an answer that no longer exists.
 *
 * Shared by the list and the detail page, which need exactly the same thing.
 */
export async function loadLiveState(
  client: SecretNetworkClient,
  proposals: Proposal[],
  voter: string | undefined
): Promise<{ tallies: Map<string, Tally>; myVotes: Map<string, VoteOption> }> {
  const open = proposals.filter((p) => p.status === 'PROPOSAL_STATUS_VOTING_PERIOD')

  const results = await Promise.all(
    open.map(async (proposal) => ({
      id: proposal.id,
      // A failed tally must not take the row down with it; the proposal still
      // reads fine without its live figures.
      tally: await queryTally(client, proposal.id).catch(() => undefined),
      vote: voter ? await queryMyVote(client, proposal.id, voter) : undefined
    }))
  )

  const tallies = new Map<string, Tally>()
  const myVotes = new Map<string, VoteOption>()
  for (const { id, tally, vote } of results) {
    if (tally) tallies.set(id, tally)
    if (vote) myVotes.set(id, vote)
  }
  return { tallies, myVotes }
}

/**
 * Every proposal, plus the numbers needed to read them and how you voted.
 *
 * Public, and loads without a wallet — governance is worth reading whether or
 * not you can vote in it. Only the per-account votes wait for a connection.
 */
export function useGovernance(): GovernanceData {
  const client = useWallet((state) => state.queryClient)
  /** In validator mode "my vote" means the validator's, not the wallet's. */
  const address = useActingAddress()

  const [proposals, setProposals] = useState<Proposal[]>([])
  const [params, setParams] = useState<GovParams | undefined>()
  const [bondedTokens, setBondedTokens] = useState(0n)
  const [tallies, setTallies] = useState<Map<string, Tally>>(new Map())
  const [myVotes, setMyVotes] = useState<Map<string, VoteOption>>(new Map())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [nonce, setNonce] = useState(0)

  /** Guards against a refresh landing after the request it replaced. */
  const generation = useRef(0)

  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    if (!client) return

    generation.current += 1
    const mine = generation.current
    const current = () => generation.current === mine

    setLoading(true)
    setError(undefined)

    const run = async () => {
      try {
        const [all, chainParams, bonded] = await Promise.all([
          queryAllProposals(client),
          // Both are decoration around the list rather than the list itself:
          // without them a proposal still reads, it just cannot say whether it
          // is passing.
          queryGovParams(client).catch(() => undefined),
          queryBondedTokens(client).catch(() => 0n)
        ])

        if (!current()) return
        setProposals(all)
        if (chainParams) setParams(chainParams)
        setBondedTokens(bonded)
        setLoading(false)

        const live = await loadLiveState(client, all, address)
        if (!current()) return
        setTallies(live.tallies)
        setMyVotes(live.myVotes)
      } catch (caught) {
        if (!current()) return
        setError(errorMessage(caught))
        setLoading(false)
      }
    }

    void run()

    return () => {
      // Anything still running belongs to a generation that is now stale.
      generation.current += 1
    }
  }, [client, address, nonce])

  return { proposals, params, bondedTokens, tallies, myVotes, loading, error, refresh }
}

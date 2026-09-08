import { useCallback, useEffect, useRef, useState } from 'react'
import type { SecretNetworkClient } from 'secretjs'

import {
  queryBondedTokens,
  queryGovParams,
  queryMyVote,
  queryProposals,
  queryTally,
  type GovParams,
  type Proposal,
  type ProposalStatus,
  type Tally,
  type VoteOption
} from '@/lib/governance'
import { useWallet } from '@/store/wallet'

const PAGE_SIZE = 25

export interface GovernanceData {
  proposals: Proposal[]
  /** How many exist under the current filter, not how many are loaded. */
  total: number
  params?: GovParams
  /** Everything staked, which is what quorum is measured against. */
  bondedTokens: bigint
  /** Live counts for proposals still open, keyed by proposal id. */
  tallies: Map<string, Tally>
  /** How the connected account voted, for proposals still open. */
  myVotes: Map<string, VoteOption>
  loading: boolean
  /** True while `loadMore` is in flight, so the list keeps what it has. */
  loadingMore: boolean
  hasMore: boolean
  error?: string
  loadMore: () => void
  refresh: () => void
}

/**
 * Proposals, the numbers needed to read them, and how you voted.
 *
 * The proposal list is public and loads without a wallet — governance is worth
 * reading whether or not you can vote in it. Only the per-account votes wait
 * for a connection.
 *
 * Tallies and votes are fetched only for proposals still in their voting
 * period. For anything closed, the tally is already on the proposal and the
 * votes have been pruned from state, so asking would be a request per row for
 * an answer the chain no longer holds.
 */
export function useGovernance(status?: ProposalStatus): GovernanceData {
  const client = useWallet((state) => state.queryClient)
  const address = useWallet((state) => state.address)

  const [proposals, setProposals] = useState<Proposal[]>([])
  const [total, setTotal] = useState(0)
  const [params, setParams] = useState<GovParams | undefined>()
  const [bondedTokens, setBondedTokens] = useState(0n)
  const [tallies, setTallies] = useState<Map<string, Tally>>(new Map())
  const [myVotes, setMyVotes] = useState<Map<string, VoteOption>>(new Map())
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [nonce, setNonce] = useState(0)

  /*
   * Guards the append path against a filter change or a refresh landing while
   * a "load more" is still in the air — without it, a page of the old filter's
   * proposals arrives after the new list and is appended to it.
   */
  const generation = useRef(0)

  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  /** Live counts and this account's votes, for whichever of these are open. */
  const loadLive = useCallback(
    async (queryClient: SecretNetworkClient, batch: Proposal[], voter: string | undefined) => {
      const open = batch.filter((p) => p.status === 'PROPOSAL_STATUS_VOTING_PERIOD')
      if (open.length === 0) return

      const results = await Promise.all(
        open.map(async (proposal) => ({
          id: proposal.id,
          // A failed tally must not take the row down with it; the proposal
          // still reads fine without its live figures.
          tally: await queryTally(queryClient, proposal.id).catch(() => undefined),
          vote: voter ? await queryMyVote(queryClient, proposal.id, voter) : undefined
        }))
      )

      setTallies((current) => {
        const next = new Map(current)
        for (const { id, tally } of results) if (tally) next.set(id, tally)
        return next
      })
      setMyVotes((current) => {
        const next = new Map(current)
        for (const { id, vote } of results) {
          if (vote) next.set(id, vote)
          // An absent vote is a fact, not a gap: it is how the list stops
          // showing a stale "you voted Yes" after a re-vote is queried again.
          else next.delete(id)
        }
        return next
      })
    },
    []
  )

  useEffect(() => {
    if (!client) return

    generation.current += 1
    const mine = generation.current
    const current = () => generation.current === mine

    setLoading(true)
    setError(undefined)

    const run = async () => {
      try {
        const [page, chainParams, bonded] = await Promise.all([
          queryProposals(client, { status, limit: PAGE_SIZE }),
          // Both are decoration around the list rather than the list itself:
          // without them a proposal still reads, it just cannot say whether it
          // is passing.
          queryGovParams(client).catch(() => undefined),
          queryBondedTokens(client).catch(() => 0n)
        ])

        if (!current()) return
        setProposals(page.proposals)
        setTotal(page.total)
        if (chainParams) setParams(chainParams)
        setBondedTokens(bonded)
        setLoading(false)

        await loadLive(client, page.proposals, address)
      } catch (caught) {
        if (!current()) return
        setError(caught instanceof Error ? caught.message : String(caught))
        setLoading(false)
      }
    }

    void run()

    return () => {
      // Anything still running belongs to a generation that is now stale.
      generation.current += 1
    }
  }, [client, status, address, nonce, loadLive])

  const loadMore = useCallback(() => {
    if (!client || loading || loadingMore) return

    const mine = generation.current
    setLoadingMore(true)

    void (async () => {
      try {
        const page = await queryProposals(client, {
          status,
          limit: PAGE_SIZE,
          offset: proposals.length
        })
        if (generation.current !== mine) return

        setProposals((existing) => {
          // Offset paging over a list that grows at the far end is stable, but
          // a proposal submitted between the two requests would shift it by
          // one — so identity, not position, decides what is new.
          const known = new Set(existing.map((p) => p.id))
          return [...existing, ...page.proposals.filter((p) => !known.has(p.id))]
        })
        setTotal(page.total)
        setLoadingMore(false)

        await loadLive(client, page.proposals, address)
      } catch (caught) {
        if (generation.current !== mine) return
        setError(caught instanceof Error ? caught.message : String(caught))
        setLoadingMore(false)
      }
    })()
  }, [client, status, address, proposals.length, loading, loadingMore, loadLive])

  return {
    proposals,
    total,
    params,
    bondedTokens,
    tallies,
    myVotes,
    loading,
    loadingMore,
    hasMore: proposals.length < total,
    error,
    loadMore,
    refresh
  }
}

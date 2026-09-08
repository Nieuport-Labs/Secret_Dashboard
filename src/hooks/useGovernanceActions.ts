import { useCallback, useState } from 'react'

import { DENOM, GAS, GAS_PRICE_USCRT } from '@/chains/secret4'
import { voteMessage, type VoteOption } from '@/lib/governance'
import { MSG_VOTE } from '@/lib/msgTypes'
import { useFeePayer } from '@/store/feePayer'
import { useWallet } from '@/store/wallet'
import type { ActionState } from '@/hooks/useStakingActions'

/**
 * Casting a vote, routed through the app's fee payer like every other
 * transaction here.
 *
 * The type URL handed to `granterFor` is not decoration: a grant restricted
 * with `AllowedMsgAllowance` has to be ruled out before it is chosen, not by
 * the chain after the fee is already committed to.
 */
export function useGovernanceActions(onSuccess?: () => void) {
  const client = useWallet((state) => state.client)
  const address = useWallet((state) => state.address)
  const granterFor = useFeePayer((state) => state.granterFor)

  const [state, setState] = useState<ActionState>({ kind: 'idle' })

  const vote = useCallback(
    async (proposalId: string, option: VoteOption) => {
      if (!client || !address) return

      setState({ kind: 'sending' })
      try {
        const message = await voteMessage(proposalId, address, option)
        const tx = await client.tx.broadcast([message], {
          gasLimit: GAS.vote,
          gasPriceInFeeDenom: GAS_PRICE_USCRT,
          feeDenom: DENOM,
          feeGranter: granterFor(GAS.vote, [MSG_VOTE])
        })

        if (tx.code !== 0) {
          setState({ kind: 'failed', message: tx.rawLog || `The chain rejected it (code ${tx.code}).` })
          return
        }

        setState({ kind: 'done', hash: tx.transactionHash })
        onSuccess?.()
      } catch (error) {
        setState({ kind: 'failed', message: error instanceof Error ? error.message : String(error) })
      }
    },
    [client, address, granterFor, onSuccess]
  )

  return { state, reset: () => setState({ kind: 'idle' }), vote }
}

import { useCallback, useState } from 'react'

import { DENOM, GAS, GAS_PRICE_USCRT } from '@/chains/secret4'
import { errorMessage } from '@/lib/errors'
import { execMessage } from '@/lib/authz'
import { voteMessage, type VoteOption } from '@/lib/governance'
import { MSG_EXEC, MSG_VOTE } from '@/lib/msgTypes'
import { useValidatorAuthority } from '@/hooks/useValidatorAuthority'
import { useFeePayer } from '@/store/feePayer'
import { useWallet } from '@/store/wallet'
import type { ActionState } from '@/hooks/useStakingActions'

/**
 * Casting a vote — as the wallet, or as the validator it is standing in for.
 *
 * In validator mode the vote belongs to the validator's own account, which is
 * the point: a validator's vote carries its delegators' stake behind it, and
 * the operator's personal balance carries almost none. When the connected
 * wallet is not that account, the same message goes out inside a `MsgExec`
 * against the grant the operator issued.
 *
 * The type URL handed to `granterFor` is not decoration: a grant restricted
 * with `AllowedMsgAllowance` has to be ruled out before it is chosen, not by
 * the chain after the fee is already committed to — and it only ever sees the
 * outer message, so a wrapped vote must be matched as `MsgExec`.
 */
export function useGovernanceActions(onSuccess?: () => void) {
  const client = useWallet((state) => state.client)
  const address = useWallet((state) => state.address)
  const granterFor = useFeePayer((state) => state.granterFor)
  const { operator, direct, grants } = useValidatorAuthority()

  const [state, setState] = useState<ActionState>({ kind: 'idle' })

  /** Whose vote this is. In validator mode, never the wallet's own. */
  const voter = operator ?? address
  const viaGrant = Boolean(operator) && !direct
  const canVote = Boolean(address && voter) && (!operator || direct || grants.has(MSG_VOTE))

  const vote = useCallback(
    async (proposalId: string, option: VoteOption) => {
      if (!client || !address || !voter) return

      setState({ kind: 'sending' })
      try {
        const message = await voteMessage(proposalId, voter, option)
        const outgoing = viaGrant ? await execMessage(address, [message]) : message
        const gas = viaGrant ? GAS.vote + GAS.authzExec : GAS.vote

        const tx = await client.tx.broadcast([outgoing], {
          gasLimit: gas,
          gasPriceInFeeDenom: GAS_PRICE_USCRT,
          feeDenom: DENOM,
          feeGranter: granterFor(gas, [viaGrant ? MSG_EXEC : MSG_VOTE])
        })

        if (tx.code !== 0) {
          setState({ kind: 'failed', message: tx.rawLog || `The chain rejected it (code ${tx.code}).` })
          return
        }

        setState({ kind: 'done', hash: tx.transactionHash })
        onSuccess?.()
      } catch (error) {
        setState({ kind: 'failed', message: errorMessage(error) })
      }
    },
    [client, address, voter, viaGrant, granterFor, onSuccess]
  )

  return { state, reset: () => setState({ kind: 'idle' }), vote, voter, canVote }
}

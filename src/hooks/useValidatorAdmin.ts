import { useCallback, useState } from 'react'
import type { Msg } from 'secretjs'

import { DENOM, GAS, GAS_PRICE_USCRT } from '@/chains/secret4'
import { errorMessage } from '@/lib/errors'
import { execMessage } from '@/lib/authz'
import { MSG_EDIT_VALIDATOR, MSG_EXEC, MSG_UNJAIL, MSG_WITHDRAW_COMMISSION } from '@/lib/msgTypes'
import {
  editValidatorMessage,
  unjailMessage,
  withdrawCommissionMessage,
  type DescriptionEdit
} from '@/lib/validator'
import { useValidatorAuthority } from '@/hooks/useValidatorAuthority'
import { useFeePayer } from '@/store/feePayer'
import { useWallet } from '@/store/wallet'
import type { ActionState } from '@/hooks/useStakingActions'

/**
 * The three transactions that change a validator.
 *
 * The messages are the same whoever sends them — the chain derives their signer
 * from the validator address rather than reading it off a field — so the only
 * question is whether this wallet is that signer. If it is, they go out plainly.
 * If instead the operator granted it permission, the same message travels inside
 * a `MsgExec`. Deciding that here keeps it out of every call site.
 *
 * Fee treatment matches `useStakingActions`, with one wrinkle: a fee grant
 * restricted by message type only ever sees the outer message, so a wrapped
 * send has to be priced and matched as `MsgExec` rather than as what it carries.
 */
export function useValidatorAdmin(valoper: string, onSuccess?: () => void) {
  const client = useWallet((state) => state.client)
  const address = useWallet((state) => state.address)
  const granterFor = useFeePayer((state) => state.granterFor)
  const { direct, grants } = useValidatorAuthority()

  const [state, setState] = useState<ActionState>({ kind: 'idle' })

  const broadcast = useCallback(
    async (message: Msg, gasLimit: number, msgType: string) => {
      if (!client || !address) return

      setState({ kind: 'sending' })
      try {
        const viaGrant = !direct && grants.has(msgType)
        const outgoing = viaGrant ? await execMessage(address, [message]) : message
        const gas = viaGrant ? gasLimit + GAS.authzExec : gasLimit
        const feeTypes = viaGrant ? [MSG_EXEC] : [msgType]

        const tx = await client.tx.broadcast([outgoing], {
          gasLimit: gas,
          gasPriceInFeeDenom: GAS_PRICE_USCRT,
          feeDenom: DENOM,
          feeGranter: granterFor(gas, feeTypes)
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
    [client, address, granterFor, direct, grants, onSuccess]
  )

  return {
    state,
    reset: () => setState({ kind: 'idle' }),

    edit: async (description: DescriptionEdit, commissionRate?: number) =>
      broadcast(
        await editValidatorMessage(valoper, description, commissionRate),
        GAS.editValidator,
        MSG_EDIT_VALIDATOR
      ),

    withdrawCommission: async () =>
      broadcast(await withdrawCommissionMessage(valoper), GAS.withdrawCommission, MSG_WITHDRAW_COMMISSION),

    unjail: async () => broadcast(await unjailMessage(valoper), GAS.unjail, MSG_UNJAIL)
  }
}

import { useCallback, useState } from 'react'
import type { Msg } from 'secretjs'

import { DENOM, GAS, GAS_PRICE_USCRT } from '@/chains/secret4'
import {
  MSG_BEGIN_REDELEGATE,
  MSG_DELEGATE,
  MSG_SET_AUTO_RESTAKE,
  MSG_UNDELEGATE,
  MSG_WITHDRAW_REWARD
} from '@/lib/msgTypes'
import { errorMessage } from '@/lib/errors'
import { coin, stakingMessages } from '@/lib/staking'
import { useFeePayer } from '@/store/feePayer'
import { useWallet } from '@/store/wallet'

export type ActionState =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'done'; hash: string }
  | { kind: 'failed'; message: string }

/**
 * Staking transactions, all of them routed through the app's fee payer.
 *
 * Every call passes its gas limit and message type URLs to `granterFor`, so
 * someone else's grant covers the fee wherever one applies. The type URLs are
 * not cosmetic: a grant restricted with `AllowedMsgAllowance` is rejected up
 * front rather than by the chain.
 */
export function useStakingActions(onSuccess?: () => void) {
  const client = useWallet((state) => state.client)
  const address = useWallet((state) => state.address)
  const granterFor = useFeePayer((state) => state.granterFor)

  const [state, setState] = useState<ActionState>({ kind: 'idle' })

  const broadcast = useCallback(
    async (messages: Msg[], gasLimit: number, msgTypes: string[]) => {
      if (!client || !address) return
      setState({ kind: 'sending' })
      try {
        const tx = await client.tx.broadcast(messages, {
          gasLimit,
          gasPriceInFeeDenom: GAS_PRICE_USCRT,
          feeDenom: DENOM,
          feeGranter: granterFor(gasLimit, msgTypes)
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
    [client, address, granterFor, onSuccess]
  )

  const delegate = useCallback(
    async (validatorAddress: string, amount: string) => {
      if (!address) return
      const { MsgDelegate } = await stakingMessages()
      await broadcast(
        [
          new MsgDelegate({
            delegator_address: address,
            validator_address: validatorAddress,
            amount: coin(amount)
          })
        ],
        GAS.delegate,
        [MSG_DELEGATE]
      )
    },
    [address, broadcast]
  )

  const undelegate = useCallback(
    async (validatorAddress: string, amount: string) => {
      if (!address) return
      const { MsgUndelegate } = await stakingMessages()
      await broadcast(
        [
          new MsgUndelegate({
            delegator_address: address,
            validator_address: validatorAddress,
            amount: coin(amount)
          })
        ],
        GAS.undelegate,
        [MSG_UNDELEGATE]
      )
    },
    [address, broadcast]
  )

  const redelegate = useCallback(
    async (fromValidator: string, toValidator: string, amount: string) => {
      if (!address) return
      const { MsgBeginRedelegate } = await stakingMessages()
      await broadcast(
        [
          new MsgBeginRedelegate({
            delegator_address: address,
            validator_src_address: fromValidator,
            validator_dst_address: toValidator,
            amount: coin(amount)
          })
        ],
        GAS.redelegate,
        [MSG_BEGIN_REDELEGATE]
      )
    },
    [address, broadcast]
  )

  /**
   * Claim from several validators at once.
   *
   * Rewards are held per validator, so claiming everything is one message each.
   * Batching them into a single transaction means one signature and one fee
   * instead of one of each per validator.
   */
  const claimRewards = useCallback(
    async (validatorAddresses: string[]) => {
      if (!address || validatorAddresses.length === 0) return
      const { MsgWithdrawDelegatorReward } = await stakingMessages()
      await broadcast(
        validatorAddresses.map(
          (validator_address) =>
            new MsgWithdrawDelegatorReward({ delegator_address: address, validator_address })
        ),
        GAS.claimRewards * validatorAddresses.length,
        [MSG_WITHDRAW_REWARD]
      )
    },
    [address, broadcast]
  )

  /**
   * Turn auto-restake on or off, for any number of validators at once.
   *
   * Secret's own message, not a standard Cosmos one: the chain compounds the
   * rewards itself. Sent as a batch for the same reason as claiming.
   */
  const setAutoRestake = useCallback(
    async (changes: Array<{ validatorAddress: string; enabled: boolean }>) => {
      if (!address || changes.length === 0) return
      const { MsgSetAutoRestake } = await stakingMessages()
      await broadcast(
        changes.map(
          (change) =>
            new MsgSetAutoRestake({
              delegator_address: address,
              validator_address: change.validatorAddress,
              enabled: change.enabled
            })
        ),
        GAS.setAutoRestake * changes.length,
        [MSG_SET_AUTO_RESTAKE]
      )
    },
    [address, broadcast]
  )

  return {
    state,
    reset: () => setState({ kind: 'idle' }),
    delegate,
    undelegate,
    redelegate,
    claimRewards,
    setAutoRestake
  }
}

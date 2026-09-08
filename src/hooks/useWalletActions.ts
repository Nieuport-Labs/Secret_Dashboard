import { useCallback, useState } from 'react'
import type { Msg } from 'secretjs'

import { DENOM, GAS, GAS_PRICE_USCRT } from '@/chains/secret4'
import { codeHashFor } from '@/lib/codeHash'
import { errorMessage } from '@/lib/errors'
import { MSG_EXECUTE_CONTRACT, MSG_SEND } from '@/lib/msgTypes'
import { depositMsg, redeemMsg, transferMsg } from '@/lib/snip20'
import { useFeePayer } from '@/store/feePayer'
import { useWallet } from '@/store/wallet'

export type ActionState =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'done'; hash: string }
  | { kind: 'failed'; message: string }

/**
 * The wallet's own transactions: sending, wrapping and unwrapping.
 *
 * Every one goes through the app's fee payer, like the staking actions do, so
 * someone else's grant covers the fee wherever one applies. The message type
 * URLs are passed along because a grant restricted with `AllowedMsgAllowance`
 * has to be ruled out before it is chosen, not after the chain refuses it.
 *
 * Code hashes are read from the chain rather than carried in the registry: a
 * query or an execute is encrypted against the hash, and a stale one fails in a
 * way that looks like the contract is broken.
 */
export function useWalletActions(onSuccess?: () => void) {
  const client = useWallet((state) => state.client)
  const queryClient = useWallet((state) => state.queryClient)
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

  /** Native SCRT, or any other bank denomination the account holds. */
  const sendNative = useCallback(
    async (recipient: string, amount: string, denom: string = DENOM) => {
      if (!address) return
      const { MsgSend } = await import('secretjs')
      await broadcast(
        [new MsgSend({ from_address: address, to_address: recipient, amount: [{ denom, amount }] })],
        GAS.send,
        [MSG_SEND]
      )
    },
    [address, broadcast]
  )

  /**
   * A SNIP-20 transfer. Private: the chain sees a contract execution, not who
   * was paid or how much.
   */
  const sendToken = useCallback(
    async (contract: string, recipient: string, amount: string) => {
      if (!address || !queryClient) return
      const { MsgExecuteContract } = await import('secretjs')
      await broadcast(
        [
          new MsgExecuteContract({
            sender: address,
            contract_address: contract,
            code_hash: await codeHashFor(queryClient, contract),
            msg: transferMsg(recipient, amount),
            sent_funds: []
          })
        ],
        GAS.snip20Transfer,
        [MSG_EXECUTE_CONTRACT]
      )
    },
    [address, queryClient, broadcast]
  )

  /**
   * Wrap a bank balance into its SNIP-20.
   *
   * The amount rides as `sent_funds` rather than in the message — the contract
   * credits whatever arrived with the call, which is why `deposit` takes no
   * arguments.
   */
  const wrap = useCallback(
    async (contract: string, denom: string, amount: string) => {
      if (!address || !queryClient) return
      const { MsgExecuteContract } = await import('secretjs')
      await broadcast(
        [
          new MsgExecuteContract({
            sender: address,
            contract_address: contract,
            code_hash: await codeHashFor(queryClient, contract),
            msg: depositMsg,
            sent_funds: [{ denom, amount }]
          })
        ],
        GAS.wrap,
        [MSG_EXECUTE_CONTRACT]
      )
    },
    [address, queryClient, broadcast]
  )

  /** Unwrap back to the bank denomination. Here the amount is in the message. */
  const unwrap = useCallback(
    async (contract: string, amount: string) => {
      if (!address || !queryClient) return
      const { MsgExecuteContract } = await import('secretjs')
      await broadcast(
        [
          new MsgExecuteContract({
            sender: address,
            contract_address: contract,
            code_hash: await codeHashFor(queryClient, contract),
            msg: redeemMsg(amount),
            sent_funds: []
          })
        ],
        GAS.unwrap,
        [MSG_EXECUTE_CONTRACT]
      )
    },
    [address, queryClient, broadcast]
  )

  const reset = useCallback(() => setState({ kind: 'idle' }), [])

  return { state, reset, sendNative, sendToken, wrap, unwrap }
}

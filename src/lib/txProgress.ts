import type { Msg, SecretNetworkClient, TxOptions, TxResponse } from 'secretjs'

import { explorerTxUrl } from '@/chains/secret4'
import { errorMessage } from '@/lib/errors'
import {
  MSG_BEGIN_REDELEGATE,
  MSG_DELEGATE,
  MSG_EDIT_VALIDATOR,
  MSG_EXECUTE_CONTRACT,
  MSG_GRANT_ALLOWANCE,
  MSG_REVOKE_ALLOWANCE,
  MSG_SEND,
  MSG_SET_AUTO_RESTAKE,
  MSG_SUBMIT_PROPOSAL,
  MSG_TRANSFER,
  MSG_UNDELEGATE,
  MSG_UNJAIL,
  MSG_VOTE,
  MSG_WITHDRAW_COMMISSION,
  MSG_WITHDRAW_REWARD
} from '@/lib/msgTypes'
import { useTransactions } from '@/store/transactions'

/**
 * Progress for every transaction the app sends, shown in the corner by
 * `Toaster`.
 *
 * Tracked here, at the point of broadcast, rather than by each screen: a
 * dozen screens send transactions and each already reports its own outcome
 * inline, but only while it is open. The card is what is left once the dialog
 * is closed or the page changed — and the one place that says the wallet is
 * waiting for approval, which is easy to miss when its popup opens behind the
 * browser.
 */

export interface TxTracker {
  signing(): void
  confirming(): void
  /** Settle on the chain's answer: code 0 is done, anything else failed. */
  settle(tx: Pick<TxResponse, 'code' | 'rawLog' | 'transactionHash'>, note?: string): void
  /** Settle on a hash from a chain with no explorer link to give. */
  done(hash: string, note?: string): void
  fail(error: unknown): void
}

export function trackTx(label: string): TxTracker {
  const { start, update } = useTransactions.getState()
  const id = start(label)

  return {
    signing: () => update(id, { stage: 'signing' }),
    confirming: () => update(id, { stage: 'confirming' }),
    settle: (tx, note) =>
      tx.code === 0
        ? update(id, {
            stage: 'done',
            hash: tx.transactionHash,
            url: explorerTxUrl(tx.transactionHash),
            note
          })
        : update(id, {
            stage: 'failed',
            hash: tx.transactionHash || undefined,
            message: tx.rawLog || `The chain rejected it (code ${tx.code}).`
          }),
    done: (hash, note) => update(id, { stage: 'done', hash, note }),
    fail: (error) => update(id, { stage: 'failed', message: errorMessage(error) })
  }
}

/**
 * `client.tx.broadcast`, in its two halves, so the card can tell waiting on
 * the wallet from waiting on a block. secretjs's own broadcast is exactly these
 * two calls with the same defaults.
 *
 * Moves the tracker through its stages but leaves settling it to the caller,
 * which may yet retry — see `sendTx`. A throw (the wallet prompt declined, say)
 * does fail it, since there is no answer from the chain to settle on.
 */
export async function signAndBroadcast(
  client: SecretNetworkClient,
  messages: Msg[],
  options: TxOptions,
  tracker: TxTracker
): Promise<TxResponse> {
  try {
    tracker.signing()
    const bytes = await client.tx.signTx(messages, options)
    tracker.confirming()
    return await client.tx.broadcastSignedTx(bytes, options)
  } catch (error) {
    tracker.fail(error)
    throw error
  }
}

/** Track, broadcast and settle, for the call sites with nothing else to do in between. */
export async function broadcastTracked(
  label: string,
  client: SecretNetworkClient,
  messages: Msg[],
  options: TxOptions
): Promise<TxResponse> {
  const tracker = trackTx(label)
  const tx = await signAndBroadcast(client, messages, options, tracker)
  tracker.settle(tx)
  return tx
}

const LABELS: Array<[string, string]> = [
  [MSG_SEND, 'Send'],
  [MSG_TRANSFER, 'IBC transfer'],
  [MSG_DELEGATE, 'Stake'],
  [MSG_UNDELEGATE, 'Unstake'],
  [MSG_BEGIN_REDELEGATE, 'Redelegate'],
  [MSG_WITHDRAW_REWARD, 'Claim rewards'],
  [MSG_SET_AUTO_RESTAKE, 'Auto-restake'],
  [MSG_EDIT_VALIDATOR, 'Edit validator'],
  [MSG_WITHDRAW_COMMISSION, 'Withdraw commission'],
  [MSG_UNJAIL, 'Unjail'],
  [MSG_VOTE, 'Vote'],
  [MSG_SUBMIT_PROPOSAL, 'Submit proposal'],
  [MSG_GRANT_ALLOWANCE, 'Fee grant'],
  [MSG_REVOKE_ALLOWANCE, 'Revoke fee grant'],
  [MSG_EXECUTE_CONTRACT, 'Contract call']
]

/**
 * A name for a transaction nobody named, from what it contains. Earlier
 * entries win, so a delegation that also claims rewards reads as "Stake".
 */
export function labelFor(msgTypes: string[]): string {
  return LABELS.find(([type]) => msgTypes.includes(type))?.[1] ?? 'Transaction'
}

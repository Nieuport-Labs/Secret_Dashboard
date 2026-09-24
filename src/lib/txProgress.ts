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
import { useTransactions, type TxLink } from '@/store/transactions'

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

/** What the card calls a transaction, and to whom or where it goes. */
export interface TxSummary {
  label: string
  detail?: string
}

export interface TrackOptions extends TxSummary {
  /**
   * The chains it passes through after being signed, in order. The first is
   * where it is broadcast. Just Secret, unless it is an IBC transfer that the
   * card should follow to the far side.
   */
  chains?: string[]
}

export interface TxTracker {
  signing(): void
  confirming(): void
  /**
   * Settle on the chain's answer: code 0 is confirmed, anything else failed.
   * With `continues`, confirmed is not the end — a packet is still to be
   * followed, and the card stays open for it.
   */
  settle(tx: Pick<TxResponse, 'code' | 'rawLog' | 'transactionHash'>, options?: { continues?: boolean }): void
  /** Confirmed on a chain other than Secret, with its own link. */
  confirmed(link?: TxLink): void
  reached(step: number, text: string): void
  link(link: TxLink): void
  finish(text: string): void
  stall(text: string): void
  fail(error: unknown): void
}

export function trackTx(options: TrackOptions | string): TxTracker {
  const { label, detail, chains = ['Secret'] } = typeof options === 'string' ? { label: options } : options
  const steps = ['Sign', ...chains]
  const { start, update, addLink } = useTransactions.getState()
  const id = start({
    label,
    detail,
    steps,
    step: 0,
    status: 'running',
    text: 'Approve it in your wallet.',
    links: []
  })

  const reached = (step: number, text: string) => update(id, { step, text, status: 'running' })
  const finish = (text: string) => update(id, { step: steps.length, text, status: 'done' })
  const afterConfirm = () =>
    steps.length > 2 ? reached(2, `On its way to ${steps[2]}…`) : finish('Confirmed.')

  return {
    signing: () => reached(0, 'Approve it in your wallet.'),
    confirming: () => reached(1, `Signed. Waiting for a block on ${steps[1]}…`),
    settle: (tx, settleOptions) => {
      if (tx.code !== 0) {
        update(id, { status: 'failed', text: tx.rawLog || `The chain rejected it (code ${tx.code}).` })
        return
      }
      addLink(id, { label: steps[1], url: explorerTxUrl(tx.transactionHash) })
      if (settleOptions?.continues) afterConfirm()
      else finish('Confirmed.')
    },
    confirmed: (link) => {
      if (link) addLink(id, link)
      afterConfirm()
    },
    reached,
    link: (link) => addLink(id, link),
    finish,
    stall: (text) => update(id, { status: 'stalled', text }),
    fail: (error) =>
      update(id, { status: 'failed', text: typeof error === 'string' ? error : errorMessage(error) })
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
  label: TrackOptions | string,
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

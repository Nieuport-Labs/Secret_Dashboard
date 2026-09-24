import type { Msg, SecretNetworkClient, TxResponse } from 'secretjs'

import { DENOM, GAS, GAS_PRICE_USCRT, PROFILE_REGISTRY_ADDRESS } from '@/chains/secret4'
import { queryNativeBalance } from '@/lib/bank'
import { codeHashFor } from '@/lib/codeHash'
import { estimateFee } from '@/lib/feegrant-sdk'
import { MSG_EXECUTE_CONTRACT } from '@/lib/msgTypes'
import { clearProfileMsg, registryConfigured } from '@/lib/profile'
import type { RecordProfile } from '@/lib/profileRecord'
import { profileState, rememberWritten } from '@/lib/profileSync'
import { labelFor, signAndBroadcast, trackTx, type TrackOptions, type TxTracker } from '@/lib/txProgress'
import { useFeePayer } from '@/store/feePayer'
import { useWallet } from '@/store/wallet'

/**
 * Every transaction the connected wallet signs for itself goes out through here.
 *
 * Two jobs. The first is the one each hook used to repeat: gas price, fee
 * denomination, and the granter the fee payer picks for these message types.
 *
 * The second is why it exists. A profile saved without gas lives as a signed
 * copy on the server (`lib/profileServer.ts`); the next transaction this
 * account sends carries the on-chain write along as one more message, so the
 * profile reaches the chain without ever needing a transaction of its own.
 *
 * A Cosmos transaction succeeds or fails whole, and that shapes every rule
 * below. The profile must never be the reason someone's send failed:
 *
 * - it is attached only when the chain was actually read and says something
 *   different, so an older copy never overwrites a newer one;
 * - only when the fee is paid by the same party with or without it — a grant
 *   restricted by message type could otherwise stop covering the send;
 * - when the sender pays, only if the balance covers the larger fee;
 * - and if the chain rejects the bundle because of the profile, the user's own
 *   messages go out again alone, and that copy is not attached again.
 *
 * Multisig, Power tools and the bridge do not come through here. Their signer
 * is not simply this wallet, or their messages are the user's to the letter.
 */

/** How long the pending check may delay a send before it is skipped. */
const ATTACH_TIMEOUT_MS = 2500

const FAILED_KEY = 'secret-dashboard:profile-attach-failed'

function failedBefore(signature: string): boolean {
  try {
    return localStorage.getItem(FAILED_KEY) === signature
  } catch {
    return false
  }
}

function rememberFailed(signature: string): void {
  try {
    localStorage.setItem(FAILED_KEY, signature)
  } catch {
    // At worst it is tried once more next time.
  }
}

/** The registry message that makes the chain say what the server copy says. */
async function registryWrite(
  queryClient: SecretNetworkClient,
  address: string,
  written: RecordProfile | null
): Promise<Msg> {
  const { MsgExecuteContract } = await import('secretjs')
  return new MsgExecuteContract({
    sender: address,
    contract_address: PROFILE_REGISTRY_ADDRESS,
    code_hash: await codeHashFor(queryClient, PROFILE_REGISTRY_ADDRESS),
    msg: written ? { set: written } : clearProfileMsg,
    sent_funds: []
  })
}

interface Attachment {
  message: Msg
  gas: number
  /** Identifies the record, so a copy the chain refused is not tried again. */
  signature: string
}

async function attachment(
  address: string,
  gasLimit: number,
  msgTypes: string[]
): Promise<Attachment | undefined> {
  const { queryClient } = useWallet.getState()
  if (!queryClient || !registryConfigured()) return undefined

  const state = await profileState(queryClient, address)
  if (!state.pending || !state.chainKnown || !state.offchain) return undefined
  if (failedBefore(state.offchain.record.signature)) return undefined

  const written = state.offchain.body.profile
  const gas = written ? GAS.setProfile : GAS.clearProfile

  const { granterFor } = useFeePayer.getState()
  const granter = granterFor(gasLimit, msgTypes)
  if (granter !== granterFor(gasLimit + gas, [...msgTypes, MSG_EXECUTE_CONTRACT])) return undefined

  if (!granter) {
    const balance = BigInt(await queryNativeBalance(queryClient, address))
    if (balance < BigInt(estimateFee(gasLimit + gas, GAS_PRICE_USCRT))) return undefined
  }

  return {
    message: await registryWrite(queryClient, address, written),
    gas,
    signature: state.offchain.record.signature
  }
}

/** Resolves `undefined` rather than holding a send hostage to a slow server. */
function withTimeout<T>(promise: Promise<T>): Promise<T | undefined> {
  return Promise.race([
    promise.catch(() => undefined),
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ATTACH_TIMEOUT_MS))
  ])
}

/**
 * Whether a failed bundle failed because of the profile message.
 *
 * Rejected before execution (`height` 0 — no fee charged, typically the larger
 * fee not being covered) counts, since the profile made it larger. So does
 * running out of gas, which the profile's gas was sized to prevent but cannot
 * rule out. After that, the log names the failing message by index.
 */
function blamesProfile(tx: TxResponse, index: number): boolean {
  if (!tx.height) return true
  if (tx.code === 11 && tx.codespace === 'sdk') return true
  const match = /message index: (\d+)/.exec(tx.rawLog ?? '')
  return match !== null && Number(match[1]) === index
}

function broadcast(
  client: SecretNetworkClient,
  messages: Msg[],
  gasLimit: number,
  msgTypes: string[],
  tracker: TxTracker
) {
  return signAndBroadcast(
    client,
    messages,
    {
      gasLimit,
      gasPriceInFeeDenom: GAS_PRICE_USCRT,
      feeDenom: DENOM,
      feeGranter: useFeePayer.getState().granterFor(gasLimit, msgTypes)
    },
    tracker
  )
}

/**
 * @param track what the progress card calls it; named from `msgTypes` when
 *   omitted. One card covers the whole call, the retry below included.
 * @param follow for a transfer the card should see arrive: called once the
 *   transaction is confirmed, and left to finish the card itself.
 */
export async function sendTx(
  client: SecretNetworkClient,
  messages: Msg[],
  gasLimit: number,
  msgTypes: string[],
  track: TrackOptions | string = labelFor(msgTypes),
  follow?: (tx: TxResponse, tracker: TxTracker) => void
): Promise<TxResponse> {
  const tracker = trackTx(track)
  const tx = await sendTxWith(client, messages, gasLimit, msgTypes, tracker)
  tracker.settle(tx, { continues: Boolean(follow) })
  if (follow && tx.code === 0) follow(tx, tracker)
  return tx
}

async function sendTxWith(
  client: SecretNetworkClient,
  messages: Msg[],
  gasLimit: number,
  msgTypes: string[],
  tracker: TxTracker
): Promise<TxResponse> {
  const { address, queryClient } = useWallet.getState()
  const attached = address ? await withTimeout(attachment(address, gasLimit, msgTypes)) : undefined

  if (!attached || !address || !queryClient) return broadcast(client, messages, gasLimit, msgTypes, tracker)

  const tx = await broadcast(
    client,
    [...messages, attached.message],
    gasLimit + attached.gas,
    [...msgTypes, MSG_EXECUTE_CONTRACT],
    tracker
  )

  if (tx.code === 0) {
    await rememberWritten(queryClient, address)
    return tx
  }

  if (!blamesProfile(tx, messages.length)) return tx

  // The profile sank it, so the user's own messages go out as they would have
  // without it — one more wallet prompt. A bundle refused before execution
  // cost nothing and may fit next time (usually the fee was just too big for
  // the balance); one that executed and failed is not tried again.
  if (tx.height) rememberFailed(attached.signature)
  return broadcast(client, messages, gasLimit, msgTypes, tracker)
}

/**
 * Write the pending copy on chain now, on its own, for someone who has the gas
 * and would rather not wait for their next transaction. Undefined when there is
 * nothing to write.
 */
export async function writePendingProfile(client: SecretNetworkClient): Promise<TxResponse | undefined> {
  const { address, queryClient } = useWallet.getState()
  if (!address || !queryClient || !registryConfigured()) return undefined

  const state = await profileState(queryClient, address)
  if (!state.pending || !state.chainKnown || !state.offchain) return undefined

  const written = state.offchain.body.profile
  const tracker = trackTx('Save profile on chain')
  const tx = await broadcast(
    client,
    [await registryWrite(queryClient, address, written)],
    written ? GAS.setProfile : GAS.clearProfile,
    [MSG_EXECUTE_CONTRACT],
    tracker
  )
  tracker.settle(tx)

  if (tx.code === 0) await rememberWritten(queryClient, address)
  return tx
}

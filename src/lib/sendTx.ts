import type { Msg, SecretNetworkClient, TxResponse } from 'secretjs'

import { DENOM, GAS, GAS_PRICE_USCRT, PROFILE_REGISTRY_ADDRESS } from '@/chains/secret4'
import { pauseRefill, refillFor } from '@/lib/autoRefill'
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
 * The second is why it exists: things that ride along on the next transaction
 * instead of needing one of their own.
 *
 * - A profile saved without gas lives as a signed copy on the server
 *   (`lib/profileServer.ts`); the next transaction carries the on-chain write.
 * - With auto-refill on, gas credits below 5 are topped up from sSCRT
 *   (`lib/autoRefill.ts`).
 *
 * A Cosmos transaction succeeds or fails whole, and that shapes every rule
 * below. Nothing riding along may be the reason someone's send failed:
 *
 * - the profile is attached only when the chain was actually read and says
 *   something different, so an older copy never overwrites a newer one;
 * - a rider is attached only when the fee is paid by the same party with or
 *   without it — a grant restricted by message type, or one too small for the
 *   larger fee, could otherwise stop covering the send;
 * - when the sender pays, only if the balance covers the larger fee;
 * - and if the chain rejects the bundle because of a rider, the user's own
 *   messages go out again alone, and that rider is not attached again soon.
 *
 * Multisig, Power tools and the bridge do not come through here. Their signer
 * is not simply this wallet, or their messages are the user's to the letter.
 */

/** How long the pending-profile check may delay a send before it is skipped. */
const PROFILE_TIMEOUT_MS = 2500
/**
 * The refill check reads more — the grant list, the sSCRT balance, two code
 * hashes — and skipping it leaves the account short of gas, so it gets longer.
 */
const REFILL_TIMEOUT_MS = 6000

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

/** Something that rides along on the user's transaction. */
interface Rider {
  messages: Msg[]
  gas: number
  /** The bundle went through. */
  landed: () => Promise<void> | void
  /** The bundle failed because of this rider. `executed`: it reached the chain and was charged. */
  blamed: (executed: boolean) => void
}

/**
 * Whether adding `extraGas` of contract executes keeps the fee with the same
 * payer — and, when that payer is the sender, whether they can afford it.
 */
async function samePayer(
  address: string,
  gasLimit: number,
  msgTypes: string[],
  extraGas: number
): Promise<boolean> {
  const { queryClient } = useWallet.getState()
  if (!queryClient) return false

  const { granterFor } = useFeePayer.getState()
  const granter = granterFor(gasLimit, msgTypes)
  if (granter !== granterFor(gasLimit + extraGas, [...msgTypes, MSG_EXECUTE_CONTRACT])) return false

  if (!granter) {
    const balance = BigInt(await queryNativeBalance(queryClient, address))
    if (balance < BigInt(estimateFee(gasLimit + extraGas, GAS_PRICE_USCRT))) return false
  }
  return true
}

async function profileRider(
  address: string,
  gasLimit: number,
  msgTypes: string[]
): Promise<Rider | undefined> {
  const { queryClient } = useWallet.getState()
  if (!queryClient || !registryConfigured()) return undefined

  const state = await profileState(queryClient, address)
  if (!state.pending || !state.chainKnown || !state.offchain) return undefined
  const signature = state.offchain.record.signature
  if (failedBefore(signature)) return undefined

  const written = state.offchain.body.profile
  const gas = written ? GAS.setProfile : GAS.clearProfile
  if (!(await samePayer(address, gasLimit, msgTypes, gas))) return undefined

  return {
    messages: [await registryWrite(queryClient, address, written)],
    gas,
    landed: () => rememberWritten(queryClient, address),
    // A bundle refused before execution cost nothing and may fit next time
    // (usually the fee was just too big for the balance); one that executed
    // and failed is not tried again.
    blamed: (executed) => {
      if (executed) rememberFailed(signature)
    }
  }
}

async function refillRider(
  address: string,
  gasLimit: number,
  msgTypes: string[]
): Promise<Rider | undefined> {
  const refill = await refillFor(address)
  if (!refill || !(await samePayer(address, gasLimit, msgTypes, refill.gas))) return undefined

  return {
    messages: refill.messages,
    gas: refill.gas,
    landed: async () => {
      pauseRefill()
      await useFeePayer.getState().refresh()
    },
    blamed: () => pauseRefill()
  }
}

/** Resolves `undefined` rather than holding a send hostage to a slow server. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([
    promise.catch(() => undefined),
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms))
  ])
}

/**
 * Which message a failed bundle failed on, as far as the chain says.
 *
 * `'unknown'` when it does not name one: rejected before execution (`height`
 * 0 — no fee charged, typically the larger fee not being covered) or out of
 * gas. Either could be any rider's doing, since the riders made it larger.
 */
function failingIndex(tx: TxResponse): number | 'unknown' | undefined {
  if (!tx.height) return 'unknown'
  if (tx.code === 11 && tx.codespace === 'sdk') return 'unknown'
  const match = /message index: (\d+)/.exec(tx.rawLog ?? '')
  return match ? Number(match[1]) : undefined
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
  const { address } = useWallet.getState()
  if (!address) return broadcast(client, messages, gasLimit, msgTypes, tracker)

  // Each rider is judged against the bundle as it stands with the ones before
  // it, so the payer check covers the whole thing that will be signed.
  const riders: Rider[] = []
  let bundleGas = gasLimit
  let bundleTypes = msgTypes
  for (const [make, ms] of [
    [refillRider, REFILL_TIMEOUT_MS],
    [profileRider, PROFILE_TIMEOUT_MS]
  ] as const) {
    const rider = await withTimeout(make(address, bundleGas, bundleTypes), ms)
    if (!rider) continue
    riders.push(rider)
    bundleGas += rider.gas
    bundleTypes = [...bundleTypes, ...rider.messages.map(() => MSG_EXECUTE_CONTRACT)]
  }

  if (riders.length === 0) return broadcast(client, messages, gasLimit, msgTypes, tracker)

  const tx = await broadcast(
    client,
    [...messages, ...riders.flatMap((rider) => rider.messages)],
    bundleGas,
    bundleTypes,
    tracker
  )

  if (tx.code === 0) {
    await Promise.all(riders.map((rider) => rider.landed()))
    return tx
  }

  const index = failingIndex(tx)
  if (index === undefined || (index !== 'unknown' && index < messages.length)) return tx

  // A rider sank it, so the user's own messages go out as they would have
  // without it — one more wallet prompt.
  let start = messages.length
  for (const rider of riders) {
    const end = start + rider.messages.length
    if (index === 'unknown' || (index >= start && index < end)) rider.blamed(Boolean(tx.height))
    start = end
  }
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

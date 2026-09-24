import type { Msg, SecretNetworkClient } from 'secretjs'

import { DENOM, GAS, GAS_PRICE_USCRT, withGasBuffer } from '@/chains/secret4'
import { sourceChain, type SourceChain } from '@/chains/sources'
import { decodeBech32, encodeBech32 } from '@/lib/bech32'
import type { Route } from '@/tokens/routes'
import { MSG_TRANSFER } from '@/lib/msgTypes'
import type { HookedTransfer } from '@/lib/ibcMemo'
import { redeemMsg } from '@/lib/snip20'

/**
 * Sending an IBC transfer from a source chain into Secret.
 *
 * Signed on the source chain, not on Secret. cosmjs is loaded on demand: it is
 * only needed by someone actually bridging, and the wallet screen should not
 * pay for it.
 */

let stargate: Promise<typeof import('@cosmjs/stargate')> | undefined
function loadStargate() {
  stargate ??= import('@cosmjs/stargate')
  return stargate
}

/** How long a packet may sit before it times out and the funds come back. */
const TIMEOUT_SECONDS = 900

export interface Leg {
  /** Denomination as the *source* chain knows it. */
  denom: string
  /** Base units. */
  amount: string
  /** Receiver and memo, which are a pair — see ibcMemo.ts. */
  transfer: HookedTransfer
  /** Overrides the chain default when the route names its own channel. */
  channel?: string
}

export interface SendOptions {
  chain: SourceChain
  sender: string
  /** The main transfer, plus optionally the gas leg. */
  legs: Leg[]
  /** Gas limit for the whole transaction. */
  gasLimit: number
}

export interface SendResult {
  hash: string
  height: number
}

function timeoutNanos(): string {
  return String((BigInt(Date.now()) + BigInt(TIMEOUT_SECONDS * 1000)) * 1_000_000n)
}

/**
 * Broadcast every leg as one transaction.
 *
 * One transaction, several messages, on purpose. The gas leg and the main
 * transfer are separate *packets* — Osmosis cannot swap part of a transfer — but
 * they are signed together, so the user approves once and cannot end up having
 * paid for gas without having bridged anything.
 */
export async function sendDeposit({ chain, sender, legs, gasLimit }: SendOptions): Promise<SendResult> {
  const { SigningStargateClient, GasPrice } = await loadStargate()

  const provider = window.keplr
  if (!provider) throw new Error('No wallet extension is available.')

  const signer = provider.getOfflineSigner(chain.chainId)

  const client = await SigningStargateClient.connectWithSigner(chain.rpc, signer as never, {
    gasPrice: GasPrice.fromString(`0.025${chain.feeDenom}`)
  })

  try {
    const messages = legs.map((leg) => ({
      typeUrl: MSG_TRANSFER,
      value: {
        sourcePort: 'transfer',
        sourceChannel: leg.channel ?? chain.depositChannel,
        token: { denom: leg.denom, amount: leg.amount },
        sender,
        receiver: leg.transfer.receiver,
        timeoutHeight: undefined,
        timeoutTimestamp: timeoutNanos(),
        // The ICS-20 memo, which is what carries the hook. Not the transaction
        // memo, which is a different field entirely and does nothing here.
        memo: leg.transfer.memo
      }
    }))

    const result = await client.signAndBroadcast(sender, messages, {
      amount: [{ denom: chain.feeDenom, amount: String(Math.ceil(gasLimit * 0.025)) }],
      gas: String(gasLimit)
    })

    if (result.code !== 0) {
      throw new Error(result.rawLog || `The source chain rejected it (code ${result.code}).`)
    }

    return { hash: result.transactionHash, height: result.height }
  } finally {
    client.disconnect()
  }
}

/**
 * Gas for a deposit, scaled by how many packets it sends.
 *
 * A hooked transfer costs more than a plain one, and the gas leg adds a second
 * packet, so a single chain default would under-estimate exactly when the
 * transaction matters most.
 */
export function depositGasLimit(chain: SourceChain, route: Route, legs: number, hooked: boolean): number {
  const base = route.gas ?? chain.depositGas
  return withGasBuffer(Math.ceil(base * legs * (hooked ? 1.5 : 1)))
}

export interface WithdrawMessageOptions {
  chain: SourceChain
  /** The Secret account sending. */
  sender: string
  /** Where it lands, in the destination chain's bech32 prefix. */
  receiver: string
  /** Denomination as *Secret* knows it — `uscrt`, or an `ibc/…` voucher. */
  denom: string
  /** Base units. */
  amount: string
  /** Overrides the chain default when the route names its own channel. */
  channel?: string
  /**
   * Unwrap this SNIP-20 into `denom` in the same transaction, immediately
   * before sending it out. This is how a withdrawal draws on the private
   * balance instead of a public one someone would otherwise have to remember
   * to unwrap by hand first. Omitted for a token that has no private form to
   * begin with — SCRT chief among them, since native SCRT is what pays gas
   * and there is nothing upstream of it to unwrap.
   */
  unwrap?: { contract: string; codeHash: string }
  /**
   * Send it to this chain first and have it forwarded from there to
   * `receiver` — the route's `forward`. `chain` stays the final destination.
   */
  forward?: Route['forward']
}

export interface WithdrawOptions extends WithdrawMessageOptions {
  client: SecretNetworkClient
  /** Fee grant to spend, if one covers this. */
  feeGranter?: string
}

/** Gas for a withdrawal, plus the unwrap when one rides along. */
export function withdrawGasLimit(chain: SourceChain, unwrap: boolean): number {
  return withGasBuffer(chain.withdrawGas) + (unwrap ? GAS.unwrap : 0)
}

/**
 * The messages that take a token out of Secret: the unwrap, when there is one,
 * then the transfer.
 *
 * Separate from `sendWithdraw` because Send builds the same pair when its
 * recipient is on another chain, and signs it through the wallet's own
 * transaction path rather than this one.
 *
 * The denomination is the one Secret knows: `uscrt` for SCRT itself, an `ibc/…`
 * voucher for anything that arrived over IBC. A SNIP-20 balance cannot be sent
 * this way directly — it has to be unwrapped into its bank denomination first —
 * so when `unwrap` is given, that redeem rides in the same transaction as the
 * transfer, ahead of it, rather than as a separate signature.
 */
export async function withdrawMessages({
  chain,
  sender,
  receiver,
  denom,
  amount,
  channel,
  unwrap,
  forward
}: WithdrawMessageOptions): Promise<Msg[]> {
  const { MsgExecuteContract, MsgTransfer } = await import('secretjs')

  const hop = forward ? forwardHop(forward, receiver) : undefined

  return [
    ...(unwrap
      ? [
          new MsgExecuteContract({
            sender,
            contract_address: unwrap.contract,
            code_hash: unwrap.codeHash,
            msg: redeemMsg(amount),
            sent_funds: []
          })
        ]
      : []),
    new MsgTransfer({
      sender,
      receiver: hop?.receiver ?? receiver,
      source_port: 'transfer',
      source_channel: channel ?? (hop ? hop.chain.withdrawChannel : chain.withdrawChannel),
      token: { denom, amount },
      // Seconds here, unlike the source-chain path above: secretjs takes
      // seconds and converts, cosmjs takes nanoseconds raw.
      timeout_timestamp: String(Math.floor(Date.now() / 1000) + TIMEOUT_SECONDS),
      memo: hop?.memo ?? ''
    })
  ]
}

/**
 * The first leg of a forwarded withdrawal: who receives it on the chain in the
 * middle, and the memo that tells that chain where to send it next.
 *
 * The middle receiver is the final recipient's own key under the middle
 * chain's prefix. Packet-forward ignores it on recent versions, but where it
 * does not, or if the forward is ever stranded there, it lands on an account
 * the recipient holds — the same 20 bytes, and every chain `FORWARDS` lists
 * derives its accounts the standard Cosmos way.
 */
function forwardHop(
  forward: NonNullable<Route['forward']>,
  receiver: string
): { chain: SourceChain; receiver: string; memo: string } {
  const chain = sourceChain(forward.via)
  const decoded = decodeBech32(receiver)
  if (!chain || !decoded) throw new Error('This route cannot be sent right now.')
  return {
    chain,
    receiver: encodeBech32(chain.prefix, decoded.bytes),
    memo: JSON.stringify({
      forward: { receiver, port: 'transfer', channel: forward.channel, timeout: '10m', retries: 2 }
    })
  }
}

/**
 * Sending an IBC transfer out of Secret.
 *
 * The mirror of a deposit, and signed on Secret rather than on the far side —
 * which means it costs SCRT for gas, and can therefore use the app's fee payer.
 */
export async function sendWithdraw({ client, feeGranter, ...options }: WithdrawOptions): Promise<SendResult> {
  const tx = await client.tx.broadcast(await withdrawMessages(options), {
    gasLimit: withdrawGasLimit(options.chain, Boolean(options.unwrap)),
    gasPriceInFeeDenom: GAS_PRICE_USCRT,
    feeDenom: DENOM,
    feeGranter
  })

  if (tx.code !== 0) {
    throw new Error(tx.rawLog || `Secret rejected it (code ${tx.code}).`)
  }

  return { hash: tx.transactionHash, height: tx.height }
}

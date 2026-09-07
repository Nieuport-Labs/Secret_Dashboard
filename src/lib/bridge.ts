import type { SecretNetworkClient } from 'secretjs'

import { DENOM, GAS, GAS_PRICE_USCRT } from '@/chains/secret4'
import type { SourceChain } from '@/chains/sources'
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
  return Math.ceil(base * legs * (hooked ? 1.5 : 1))
}

export interface WithdrawOptions {
  client: SecretNetworkClient
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
  /** Fee grant to spend, if one covers this. */
  feeGranter?: string
  /**
   * Unwrap this SNIP-20 into `denom` in the same transaction, immediately
   * before sending it out. This is how a withdrawal draws on the private
   * balance instead of a public one someone would otherwise have to remember
   * to unwrap by hand first. Omitted for a token that has no private form to
   * begin with — SCRT chief among them, since native SCRT is what pays gas
   * and there is nothing upstream of it to unwrap.
   */
  unwrap?: { contract: string; codeHash: string }
}

/**
 * Sending an IBC transfer out of Secret.
 *
 * The mirror of a deposit, and signed on Secret rather than on the far side —
 * which means it costs SCRT for gas, and can therefore use the app's fee payer.
 *
 * The denomination is the one Secret knows: `uscrt` for SCRT itself, an `ibc/…`
 * voucher for anything that arrived over IBC. A SNIP-20 balance cannot be sent
 * this way directly — it has to be unwrapped into its bank denomination first —
 * so when `unwrap` is given, that redeem rides in the same transaction as the
 * transfer, ahead of it, rather than as a separate signature.
 */
export async function sendWithdraw({
  client,
  chain,
  sender,
  receiver,
  denom,
  amount,
  channel,
  feeGranter,
  unwrap
}: WithdrawOptions): Promise<SendResult> {
  const { MsgExecuteContract, MsgTransfer } = await import('secretjs')

  const gasLimit = chain.withdrawGas + (unwrap ? GAS.unwrap : 0)
  const messages = [
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
      receiver,
      source_port: 'transfer',
      source_channel: channel ?? chain.withdrawChannel,
      token: { denom, amount },
      // Seconds here, unlike the source-chain path above: secretjs takes
      // seconds and converts, cosmjs takes nanoseconds raw.
      timeout_timestamp: String(Math.floor(Date.now() / 1000) + TIMEOUT_SECONDS),
      memo: ''
    })
  ]

  const tx = await client.tx.broadcast(messages, {
    gasLimit,
    gasPriceInFeeDenom: GAS_PRICE_USCRT,
    feeDenom: DENOM,
    feeGranter
  })

  if (tx.code !== 0) {
    throw new Error(tx.rawLog || `Secret rejected it (code ${tx.code}).`)
  }

  return { hash: tx.transactionHash, height: tx.height }
}

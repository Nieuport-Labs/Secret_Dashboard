import type { SourceChain } from '@/chains/sources'
import type { Route } from '@/tokens/routes'
import { MSG_TRANSFER } from '@/lib/msgTypes'
import type { HookedTransfer } from '@/lib/ibcMemo'

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

  const provider = window.keplr ?? window.starshell?.keplr
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

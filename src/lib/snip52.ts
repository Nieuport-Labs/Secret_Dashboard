import type { Permit } from '@/lib/permit'

/**
 * SNIP-52 private push notifications.
 *
 * Instead of asking every token contract every few seconds whether anything
 * arrived, the client works out ahead of time what the notification ID for its
 * *next* incoming transfer will be, and watches the Tendermint event stream for
 * exactly that string. The contract emits it as a plaintext log attribute when
 * the event happens. Only the contract and the recipient know what that ID
 * means, so the notification is public but unreadable.
 *
 * The derivation, decryption (ChaCha20-Poly1305) and payload decoding are
 * neutrino's, deliberately. The `recvd` channel is a sequenced binary schema
 * whose CDDL differs between contract builds — one ships
 * `sender:bstr .size 20`, another `.size 54` — so the schema has to be read
 * from `channel_info` at runtime rather than assumed. Reimplementing that by
 * hand is the kind of thing that goes quietly wrong.
 *
 * neutrino is loaded on demand: it pulls in its own crypto and protobuf
 * machinery, and someone who has turned notifications off should never pay for
 * it.
 */

/** The channel carrying incoming transfers, per the SNIP-20 reference impl. */
export const CHANNEL_RECEIVED = 'recvd'

export interface Snip52Notification {
  contractAddress: string
  channel: string
  /** Base units, when the payload carried an amount. */
  amount?: string
  /** Whatever the channel actually decoded to, for anything not modelled here. */
  raw: unknown
}

export type NotificationHandler = (notification: Snip52Notification) => void

let neutrino: Promise<typeof import('@solar-republic/neutrino')> | undefined
function loadNeutrino() {
  neutrino ??= import('@solar-republic/neutrino')
  return neutrino
}

/**
 * Pull an amount out of a decoded payload without assuming its exact shape.
 *
 * `recvd` decodes to a sequence — `[amount, sender, memo_len]` — but the schema
 * is the contract's to change, and a channel this app does not model may decode
 * to a map instead. Reading defensively means an unexpected shape costs the
 * amount in one toast, not a thrown exception inside a WebSocket callback.
 */
function readAmount(data: unknown): string | undefined {
  if (typeof data === 'bigint') return data.toString()
  if (typeof data === 'number' && Number.isFinite(data)) return Math.trunc(data).toString()

  if (Array.isArray(data)) {
    const first = data[0]
    if (typeof first === 'bigint' || typeof first === 'number') return readAmount(first)
    return undefined
  }

  if (data && typeof data === 'object' && 'amount' in data) {
    return readAmount((data as { amount: unknown }).amount)
  }

  return undefined
}

export interface SubscribeOptions {
  rpcUrl: string
  lcdUrl: string
  contractAddress: string
  permit: Permit
  onNotification: NotificationHandler
  /** Called when the socket drops or the subscription cannot be established. */
  onError?: (error: unknown) => void
}

/**
 * Watch one token's `recvd` channel.
 *
 * @returns a function that stops listening. Always call it — an orphaned
 *   subscription keeps a WebSocket listener alive for the life of the page.
 */
export async function subscribeReceived({
  rpcUrl,
  lcdUrl,
  contractAddress,
  permit,
  onNotification,
  onError
}: SubscribeOptions): Promise<() => void> {
  const { SecretContract, subscribe_snip52_channels } = await loadNeutrino()

  const contract = await SecretContract(lcdUrl, contractAddress as `secret1${string}`)

  return subscribe_snip52_channels(
    rpcUrl as `https://${string}`,
    contract,
    // A SNIP-24 permit is one of the auth secrets neutrino accepts, alongside
    // viewing keys. Passing the permit means no viewing key is ever needed.
    permit as never,
    {
      [CHANNEL_RECEIVED]: (data: unknown) => {
        try {
          onNotification({
            contractAddress,
            channel: CHANNEL_RECEIVED,
            amount: readAmount(data),
            raw: data
          })
        } catch (error) {
          onError?.(error)
        }
      }
    } as never
  )
}

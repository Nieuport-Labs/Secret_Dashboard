/**
 * Moving proposals between members without a server in the middle.
 *
 * Waku is a peer-to-peer messaging network: a light node in the browser hands
 * a message to a service node, which relays it to everyone subscribed to the
 * same topic. Nobody operates the group's channel, so nobody can take it away
 * — there is no account to suspend, no endpoint to block, and no operator to
 * ask. That is the whole reason for choosing it over a small server, which
 * would have been less code and one more party able to stop the group working.
 *
 * ## What it is not
 *
 * It is not part of the security model, and nothing here is trusted. Every
 * envelope that arrives goes through the same parser and the same checks as
 * one pasted from the clipboard, because a transport that could be relied on
 * for authenticity would be a transport that could betray it. What Waku buys
 * is availability and metadata privacy: members do not have to be online at
 * the same moment, and an observer cannot find the conversation at all — see
 * `room.ts` for why the topic comes from the group's own secret.
 *
 * So this file's failures are never fatal. Unreachable, no peers, a push that
 * did not go: all of it degrades to "use the clipboard", which is always on
 * screen anyway.
 *
 * ## Practical limits, all of them deliberate
 *
 * - **150 KB a message.** The network's own cap. A proposal is a few KB.
 * - **About one message a second.** Rate limiting is enforced with RLN by the
 *   service node, which carries the credential so the browser does not have to.
 *   Publishes are therefore queued rather than fired in parallel.
 * - **Roughly 48 hours of history.** Store nodes keep messages that long by
 *   default, so a signing round that outlives it needs the proposal
 *   re-published. `history` is what a client catches up from on connect, and
 *   re-publishing is how the group stays in sync without anyone holding state
 *   for them.
 *
 * Everything is imported dynamically. libp2p and its dependencies are several
 * megabytes, and a wallet screen has no business downloading them — the same
 * discipline `src/store/wallet.ts` applies to secretjs.
 */

import type { Room } from '@/lib/waku/room'

export type TransportStatus = 'idle' | 'starting' | 'online' | 'degraded' | 'stopped'

export interface Transport {
  publish: (bytes: Uint8Array) => Promise<void>
  subscribe: (onMessage: (bytes: Uint8Array) => void) => Promise<() => void>
  /** Everything the store nodes still hold for this topic, newest first. */
  history: (sinceMs: number) => Promise<Uint8Array[]>
  peers: () => number
  stop: () => Promise<void>
}

export interface TransportOptions {
  /** How long to wait for the protocols a publish needs. */
  timeoutMs?: number
  onStatus?: (status: TransportStatus) => void
}

/** Enough for a browser to find peers on a slow connection, short enough to give up. */
const DEFAULT_TIMEOUT_MS = 15_000

/** Comfortably inside the network's ~1/s ceiling, with room for a burst to drain. */
const PUBLISH_INTERVAL_MS = 1_200

/** The network's own cap, minus room for the framing around a payload. */
export const MAX_PAYLOAD_BYTES = 140_000

export class TransportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TransportError'
  }
}

/**
 * Start a node and join one group's topic.
 *
 * Resolves once there are peers to publish through; rejects if there are none
 * before the timeout, which the caller shows as "offline" rather than as an
 * error — the manual routes still work and are the point of the fallback.
 */
export async function createTransport(room: Room, options: TransportOptions = {}): Promise<Transport> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, onStatus } = options
  onStatus?.('starting')

  const [sdk, symmetric] = await Promise.all([
    import('@waku/sdk'),
    import('@waku/message-encryption/symmetric')
  ])

  const node = await sdk.createLightNode({ defaultBootstrap: true })
  await node.start()

  /*
   * The routing information the encoder needs, built the same way the node
   * builds it for its own encoders. Taken from the node's network config
   * rather than assumed, so a node started against another cluster does not
   * silently publish where nobody is listening.
   */
  const routingInfo = sdk.utils.createRoutingInfo(sdk.DefaultNetworkConfig, {
    contentTopic: room.contentTopic
  })

  const encoder = symmetric.createEncoder({
    contentTopic: room.contentTopic,
    routingInfo,
    symKey: room.symKey
  })
  const decoder = symmetric.createDecoder(room.contentTopic, routingInfo, room.symKey)

  try {
    await node.waitForPeers([sdk.Protocols.LightPush, sdk.Protocols.Filter], timeoutMs)
    onStatus?.('online')
  } catch {
    // Started, but with nobody to talk to yet. Peers can still appear later,
    // so the node is kept rather than torn down — and the caller is told the
    // truth in the meantime.
    onStatus?.('degraded')
  }

  let lastPublish = 0
  let queue: Promise<void> = Promise.resolve()

  const publish = (bytes: Uint8Array): Promise<void> => {
    if (bytes.length > MAX_PAYLOAD_BYTES) {
      return Promise.reject(new TransportError('That is too large to send over Waku. Use the file instead.'))
    }

    // Serialised rather than parallel: three envelopes sent at once — a
    // proposal, a signature, a receipt — would otherwise trip the network's
    // rate limit and the third would simply vanish.
    queue = queue.then(async () => {
      const wait = Math.max(0, PUBLISH_INTERVAL_MS - (Date.now() - lastPublish))
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))

      const result = await node.lightPush!.send(encoder, { payload: bytes })
      lastPublish = Date.now()

      if (result.successes.length === 0) {
        onStatus?.('degraded')
        const reason = result.failures?.[0]?.error
        throw new TransportError(
          `Nobody took the message${reason ? `: ${String(reason)}` : ''}. It is still on this screen — send it another way.`
        )
      }
      onStatus?.('online')
    })

    return queue
  }

  const subscribe = async (onMessage: (bytes: Uint8Array) => void): Promise<() => void> => {
    const handler = (message: { payload?: Uint8Array }): void => {
      if (message.payload?.length) onMessage(message.payload)
    }

    await node.filter!.subscribe(decoder, handler)
    return () => {
      void node.filter!.unsubscribe(decoder)
    }
  }

  const history = async (sinceMs: number): Promise<Uint8Array[]> => {
    const found: Uint8Array[] = []
    try {
      await node.store!.queryWithOrderedCallback(
        [decoder],
        (message) => {
          if (message.payload?.length) found.push(message.payload)
        },
        { timeStart: new Date(Date.now() - sinceMs) }
      )
    } catch {
      // No store peer, or it refused. Catching up is a convenience — the
      // proposals this browser already holds are unaffected.
      onStatus?.('degraded')
    }
    return found
  }

  return {
    publish,
    subscribe,
    history,
    peers: () => node.libp2p.getConnections().length,
    stop: async () => {
      onStatus?.('stopped')
      await node.stop()
    }
  }
}

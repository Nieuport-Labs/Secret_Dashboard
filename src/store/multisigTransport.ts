import { create } from 'zustand'

import { encodeEnvelope, type Envelope } from '@/lib/multisig/bundle'
import { errorMessage } from '@/lib/errors'
import { deriveRoom } from '@/lib/waku/room'
import type { Transport, TransportStatus } from '@/lib/waku/transport'

/**
 * The live connection to a group's own Waku topic, and what it is doing.
 *
 * Not persisted and deliberately not reconnected on its own: a node holds
 * sockets and a peer table, and one per browser tab per account is the most
 * that should ever exist. Whoever mounts the sync hook starts it, and leaving
 * multisig mode stops it.
 *
 * Every method here is safe to call when there is no connection. That is the
 * point of the whole design — the transport is an optimisation over passing
 * files around by hand, so its absence must never be an error anybody has to
 * handle. `publish` returning `false` means "this did not go out"; the screens
 * answer that with the clipboard, which is on them anyway.
 */

interface TransportState {
  status: TransportStatus
  /** Which multisig this connection belongs to. */
  account?: string
  peers: number
  /** The last thing that went wrong, for the chip's tooltip. Never thrown. */
  error?: string

  start: (account: string, roomSecret: string) => Promise<void>
  stop: () => Promise<void>
  /** `false` when it did not go out, for any reason. Never throws. */
  publish: (envelope: Envelope) => Promise<boolean>
  subscribe: (onMessage: (bytes: Uint8Array) => void) => Promise<() => void>
  history: (sinceMs: number) => Promise<Uint8Array[]>
}

/** Held outside the store: it is a live object, not state to render. */
let transport: Transport | undefined
let starting: Promise<void> | undefined

/**
 * The transport module is fetched when a connection is first wanted, not when
 * this store is imported.
 *
 * It is the door to libp2p, which is megabytes, and this store is imported by
 * the app shell — so a static import here would put the whole peer-to-peer
 * stack in the first download of a wallet screen that may never open a
 * multisig at all.
 */
function loadTransport(): Promise<typeof import('@/lib/waku/transport')> {
  return import('@/lib/waku/transport')
}

export const useMultisigTransport = create<TransportState>()((set, get) => ({
  status: 'idle',
  peers: 0,

  start: async (account, roomSecret) => {
    if (get().account === account && transport) return
    if (starting) return starting

    if (transport) await get().stop()

    starting = (async () => {
      set({ status: 'starting', account, error: undefined })
      try {
        const { createTransport } = await loadTransport()
        transport = await createTransport(deriveRoom(roomSecret), {
          onStatus: (status) => set({ status, peers: transport?.peers() ?? 0 })
        })
        set({ peers: transport.peers() })
      } catch (caught) {
        // Starting a node can fail outright — no network, a browser that
        // refuses WebSockets. The group is not blocked by it.
        transport = undefined
        set({ status: 'degraded', error: errorMessage(caught) })
      } finally {
        starting = undefined
      }
    })()

    return starting
  },

  stop: async () => {
    const current = transport
    transport = undefined
    set({ status: 'stopped', account: undefined, peers: 0 })
    if (current) await current.stop().catch(() => undefined)
  },

  publish: async (envelope) => {
    if (!transport) return false
    try {
      await transport.publish(encodeEnvelope(envelope))
      set({ peers: transport.peers() })
      return true
    } catch (caught) {
      set({ error: errorMessage(caught) })
      return false
    }
  },

  subscribe: async (onMessage) => {
    if (!transport) return () => undefined
    try {
      return await transport.subscribe(onMessage)
    } catch (caught) {
      set({ error: errorMessage(caught) })
      return () => undefined
    }
  },

  history: async (sinceMs) => {
    if (!transport) return []
    try {
      return await transport.history(sinceMs)
    } catch (caught) {
      set({ error: errorMessage(caught) })
      return []
    }
  }
}))

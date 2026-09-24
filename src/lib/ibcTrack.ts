import { mintscanTxUrl } from '@/chains/sources'
import type { TxTracker } from '@/lib/txProgress'

/**
 * Following an IBC transfer past the chain it was sent from, to the one it
 * was sent to — and, for a forwarded one, through the chain in the middle.
 *
 * A transaction confirmed on Secret proves only that the packet left. Whether
 * it arrived is recorded on the other side, as a `recv_packet` in some
 * relayer's transaction, and the acknowledgement written next to it says
 * whether the receiving chain accepted it. That transaction is what the
 * progress card links to: the proof it got there, on an explorer that indexes
 * the far chain.
 */

interface Attribute {
  key: string
  value: string
}

export interface TxEvent {
  type: string
  attributes: readonly Attribute[]
}

export interface Packet {
  sequence: string
  /** Channel on the receiving chain — what `recv_packet` there is filed under. */
  dstChannel: string
}

/** One chain the packet lands on, in order. */
export interface Hop {
  chainId: string
  name: string
  lcds: string[]
  /** Set on a chain that passes it on: the channel it forwards over. */
  forwardChannel?: string
}

/** Some nodes still return attributes base64-encoded; most do not. */
function decode(text: string): string {
  if (!/^[A-Za-z0-9+/]+=*$/.test(text) || text.length % 4 !== 0) return text
  try {
    const decoded = atob(text)
    return /^[\x20-\x7e]*$/.test(decoded) ? decoded : text
  } catch {
    return text
  }
}

function attr(event: TxEvent, key: string): string | undefined {
  const found = event.attributes.find((a) => a.key === key || decode(a.key) === key)
  return found ? decode(found.value) : undefined
}

/** The packets a transaction sent, over `srcChannel` when given. */
export function sentPackets(events: readonly TxEvent[], srcChannel?: string): Packet[] {
  return events
    .filter((event) => event.type === 'send_packet')
    .filter((event) => !srcChannel || attr(event, 'packet_src_channel') === srcChannel)
    .flatMap((event) => {
      const sequence = attr(event, 'packet_sequence')
      const dstChannel = attr(event, 'packet_dst_channel')
      return sequence && dstChannel ? [{ sequence, dstChannel }] : []
    })
}

interface FoundTx {
  hash: string
  events: TxEvent[]
}

/**
 * The transaction on this chain that received the packet, if one has yet.
 *
 * Asked two ways because nodes disagree on how: Cosmos SDK 0.50 takes a single
 * `query`, older ones a repeated `events`.
 */
async function findReceipt(
  lcds: string[],
  packet: Packet,
  signal: AbortSignal
): Promise<FoundTx | undefined> {
  const conditions = [
    `recv_packet.packet_dst_channel='${packet.dstChannel}'`,
    `recv_packet.packet_sequence='${packet.sequence}'`
  ]
  const queries = [
    `query=${encodeURIComponent(conditions.join(' AND '))}`,
    conditions.map((condition) => `events=${encodeURIComponent(condition)}`).join('&')
  ]

  for (const base of lcds) {
    for (const query of queries) {
      try {
        const response = await fetch(`${base}/cosmos/tx/v1beta1/txs?${query}&order_by=ORDER_BY_ASC`, {
          signal
        })
        if (!response.ok) continue
        const body = (await response.json()) as {
          tx_responses?: Array<{ txhash: string; code: number; events?: TxEvent[] }>
        }
        // A relayer that lost the race still lands a transaction; only the
        // one that actually received the packet carries the event for it.
        const found = (body.tx_responses ?? []).find(
          (tx) => tx.code === 0 && receiveEvent(tx.events ?? [], packet) !== undefined
        )
        if (found) return { hash: found.txhash, events: found.events ?? [] }
        if (body.tx_responses) break
      } catch (error) {
        if (signal.aborted) throw error
      }
    }
  }
  return undefined
}

function matches(event: TxEvent, packet: Packet): boolean {
  return (
    attr(event, 'packet_sequence') === packet.sequence &&
    attr(event, 'packet_dst_channel') === packet.dstChannel
  )
}

function receiveEvent(events: TxEvent[], packet: Packet): TxEvent | undefined {
  return events.find((event) => event.type === 'recv_packet' && matches(event, packet))
}

/**
 * What the receiving chain said: accepted, refused (with why), or nothing yet
 * — a chain forwarding it on answers only once the next one has.
 */
function acknowledgement(
  events: TxEvent[],
  packet: Packet
): { ok: true } | { ok: false; error: string } | undefined {
  const ack = events.find((event) => event.type === 'write_acknowledgement' && matches(event, packet))
  if (!ack) return undefined
  const raw = attr(ack, 'packet_ack') ?? ''
  try {
    const parsed = JSON.parse(raw) as { result?: string; error?: string }
    return parsed.error ? { ok: false, error: parsed.error } : { ok: true }
  } catch {
    return { ok: true }
  }
}

/**
 * A packet's data as text. Newer ibc-go emits only the hex form — Cosmos Hub
 * does — older versions only the plain one.
 */
function packetData(event: TxEvent): string {
  const plain = attr(event, 'packet_data')
  if (plain) return plain
  const hex = attr(event, 'packet_data_hex') ?? ''
  const bytes = hex.match(/../g)?.map((pair) => parseInt(pair, 16)) ?? []
  return new TextDecoder().decode(Uint8Array.from(bytes))
}

/**
 * The packet a forwarding chain sent on. Matched by the final receiver in its
 * data, since a relayer's transaction may carry many packets at once and
 * nothing else ties the outgoing one to ours.
 */
function forwarded(events: TxEvent[], channel: string, receiver: string): Packet | undefined {
  const event = events.find(
    (candidate) =>
      candidate.type === 'send_packet' &&
      attr(candidate, 'packet_src_channel') === channel &&
      packetData(candidate).includes(receiver)
  )
  const sequence = event && attr(event, 'packet_sequence')
  const dstChannel = event && attr(event, 'packet_dst_channel')
  return sequence && dstChannel ? { sequence, dstChannel } : undefined
}

const POLL_MS = 6_000
/** Past the packet's own timeout, with room for a slow relayer. */
const HOP_DEADLINE_MS = 20 * 60_000

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Walk the tracker through each hop as the packet lands on it.
 *
 * @param firstStep the tracker step that stands for `hops[0]`
 * @param receiver the final recipient, to pick the forwarded packet out of a
 *   relayer's batch
 */
export async function followPacket(
  tracker: TxTracker,
  packet: Packet,
  hops: Hop[],
  firstStep: number,
  receiver: string
): Promise<void> {
  const controller = new AbortController()
  let current: Packet | undefined = packet

  try {
    for (const [index, hop] of hops.entries()) {
      const step = firstStep + index
      tracker.reached(step, `On its way to ${hop.name}…`)

      const deadline = Date.now() + HOP_DEADLINE_MS
      let receipt: FoundTx | undefined
      while (!receipt && Date.now() < deadline) {
        receipt = await findReceipt(hop.lcds, current!, controller.signal)
        if (!receipt) await wait(POLL_MS)
      }

      if (!receipt) {
        tracker.stall(
          `Not seen on ${hop.name} yet. Relayers can be slow; if it never arrives it is refunded on the chain it left.`
        )
        return
      }

      const url = mintscanTxUrl(hop.chainId, receipt.hash)
      if (url) tracker.link({ label: hop.name, url })

      const ack = acknowledgement(receipt.events, current!)
      if (ack && !ack.ok) {
        tracker.fail(`${hop.name} refused it (${ack.error}). It is refunded to the address it was sent from.`)
        return
      }

      if (hop.forwardChannel) {
        current = forwarded(receipt.events, hop.forwardChannel, receiver)
        if (!current) {
          tracker.stall(`It reached ${hop.name}, but the transfer on from there was not found.`)
          return
        }
        continue
      }

      tracker.finish(`Arrived on ${hop.name}.`)
      return
    }
  } catch (error) {
    tracker.fail(error)
  }
}

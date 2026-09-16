import { useEffect } from 'react'

import { decodeEnvelope, encodeEnvelope, type Envelope } from '@/lib/multisig/bundle'
import { fingerprintOf, type MultisigConfig } from '@/lib/multisig/config'
import { useMultisigProposals } from '@/store/multisigProposals'
import { useMultisigTransport } from '@/store/multisigTransport'

/**
 * Keeping one browser's copy of a group's proposals roughly level with
 * everyone else's.
 *
 * "Roughly" is the honest word. There is no shared list and no server holding
 * one: each member has their own copy, and two of them differing is the normal
 * state of a signing round rather than a fault. What this does is make the
 * copies converge without anybody pasting anything — a proposal published when
 * it is composed, a signature published when it is made, and on connecting, a
 * catch-up over whatever the store nodes still hold.
 *
 * ## Why it republishes
 *
 * Waku's store nodes keep messages for about two days. A signing round that
 * runs longer than that — a member on holiday, a group that meets weekly —
 * would otherwise find the proposal simply gone from the network, and a member
 * joining late would have nothing to catch up on. So every client publishes
 * what it holds and did not hear about during catch-up. With every member
 * doing that, the group's state survives as long as any one of them still has
 * it, which is what replaces a server.
 *
 * Duplicates are normal, not a fault: a message relayed by two service nodes
 * arrives twice, and the store hands it back again on the next catch-up.
 * Everything here is idempotent by construction — a proposal replaces itself,
 * a signature is keyed by its signer — so nothing has to deduplicate.
 *
 * ## What is trusted
 *
 * Nothing. Anyone who knows a topic can publish to it, so bytes that arrive
 * here go through the same parser and the same checks as a bundle pasted from
 * the clipboard. The worst a hostile publisher can do is fill a list with
 * proposals that fail their checks.
 */

/** Store retention is around 48 hours; asking for more only wastes a query. */
const CATCH_UP_MS = 48 * 60 * 60 * 1000

export function useMultisigSync(config: MultisigConfig | undefined): void {
  const start = useMultisigTransport((state) => state.start)
  const stop = useMultisigTransport((state) => state.stop)
  const subscribe = useMultisigTransport((state) => state.subscribe)
  const history = useMultisigTransport((state) => state.history)
  const publish = useMultisigTransport((state) => state.publish)

  const address = config?.address
  const roomSecret = config?.roomKey

  useEffect(() => {
    if (!address || !roomSecret || !config) return

    let cancelled = false
    let unsubscribe: (() => void) | undefined

    /**
     * File an envelope, if it belongs to this account at all.
     *
     * The fingerprint check is not security — a hostile publisher can copy a
     * fingerprint — it is hygiene, so that two groups sharing nothing but a
     * mistake do not end up in each other's lists. The real checks are on the
     * proposal screen, where there is room to say what failed.
     */
    const file = (envelope: Envelope): void => {
      if (envelope.fingerprint !== fingerprintOf(config)) return
      const store = useMultisigProposals.getState()

      if (envelope.kind === 'proposal') {
        store.upsert(envelope)
        return
      }
      if (envelope.kind === 'signature') {
        store.addSignature(envelope.proposalId, address, envelope)
        return
      }
      store.recordBroadcast(envelope)
    }

    const run = async () => {
      await start(address, roomSecret)
      if (cancelled) return

      unsubscribe = await subscribe((bytes) => {
        try {
          file(decodeEnvelope(bytes))
        } catch {
          // Somebody else's message, or nobody's. Not worth a word on screen.
        }
      })
      if (cancelled) return

      const heard = new Set<string>()
      for (const bytes of await history(CATCH_UP_MS)) {
        try {
          const envelope = decodeEnvelope(bytes)
          heard.add(identity(envelope))
          file(envelope)
        } catch {
          /* as above */
        }
      }
      if (cancelled) return

      // Everything this browser holds that the network did not mention. A
      // member who has been offline for three days is how a proposal
      // disappears from Waku while still being very much alive.
      const entries = Object.values(useMultisigProposals.getState().byAccount[address] ?? {})
      for (const entry of entries) {
        if (entry.receipt) continue
        if (!heard.has(identity(entry.proposal))) await publish(entry.proposal)
        for (const signature of entry.signatures) {
          if (!heard.has(identity(signature))) await publish(signature)
        }
      }
    }

    void run()

    return () => {
      cancelled = true
      unsubscribe?.()
    }
    // `config` is only read for its fingerprint, which the address determines.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, roomSecret])

  // Leaving multisig mode takes the node down with it: it holds sockets, and
  // one per account per tab is already the most that should exist.
  useEffect(() => {
    if (address) return
    void stop()
  }, [address, stop])
}

/** What counts as "the same envelope", for deciding what still needs publishing. */
function identity(envelope: Envelope): string {
  if (envelope.kind === 'proposal') return `proposal:${envelope.id}`
  if (envelope.kind === 'signature') return `signature:${envelope.proposalId}:${envelope.pubkey}`
  return `broadcast:${envelope.proposalId}`
}

/** Exposed for the screens that create something worth sending straight away. */
export function publishEnvelope(envelope: Envelope): Promise<boolean> {
  // Sized here rather than at the transport, so a bundle too large for Waku is
  // still saved locally and still shareable as a file.
  try {
    encodeEnvelope(envelope)
  } catch {
    return Promise.resolve(false)
  }
  return useMultisigTransport.getState().publish(envelope)
}

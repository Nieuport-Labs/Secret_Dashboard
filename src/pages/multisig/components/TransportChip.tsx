import { Radio, RadioTower, WifiOff } from 'lucide-react'

import { useMultisigTransport } from '@/store/multisigTransport'

/**
 * Whether the group's peer-to-peer channel is up.
 *
 * Worth showing, and worth showing quietly — which is why it lives in the
 * footer beside the attribution now rather than as a card on two screens. It
 * used to be a panel with a paragraph under it, which is a lot of furniture
 * for a line that says "yes, still up" ninety-nine times out of a hundred.
 * Down, it means exactly one thing — copy and paste instead — and never that
 * something is broken, so it earns no colour and no border either.
 *
 * The full explanation rides along as a tooltip. "Peer-to-peer" is doing real
 * work in it: there is no server holding these proposals, so there is nobody
 * to suspend the group's account or block its endpoint, and equally nobody to
 * keep a copy for a member who was offline all week. Both halves follow from
 * the same fact and a member should be able to find it.
 */
export default function TransportChip() {
  const status = useMultisigTransport((state) => state.status)
  const peers = useMultisigTransport((state) => state.peers)
  const error = useMultisigTransport((state) => state.error)

  const online = status === 'online'
  const trying = status === 'starting'

  const explanation = online
    ? 'Proposals and signatures reach the other members on their own, over Waku. No server holds them: the network keeps a message for about two days, and every member’s copy re-publishes what it still has, so nothing is lost as long as one of you is around.'
    : `Proposals still work — copy, download or scan them across by hand. Nothing depends on the connection, and nothing that arrives over it is trusted any more than a file would be.${
        error ? ` Last problem: ${error}` : ''
      }`

  return (
    <span className="flex items-center gap-1.5 text-label" title={explanation}>
      {online ? (
        <RadioTower size={13} aria-hidden className="text-positive" />
      ) : trying ? (
        <Radio size={13} aria-hidden />
      ) : (
        <WifiOff size={13} aria-hidden />
      )}
      {/*
        Named, not described as "the group's channel". Waku is a thing a member
        can go and read about, and the name is what tells them this is a public
        p2p network rather than something this app runs — which is the whole
        claim being made about where their proposals go.
      */}
      {online
        ? `Connected to Waku · ${peers} peer${peers === 1 ? '' : 's'}`
        : trying
          ? 'Connecting to Waku…'
          : 'Waku offline — pass proposals across by hand'}
    </span>
  )
}

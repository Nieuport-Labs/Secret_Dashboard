import { Radio, RadioTower, WifiOff } from 'lucide-react'

import { useMultisigTransport } from '@/store/multisigTransport'

/**
 * Whether the group's peer-to-peer channel is up.
 *
 * Worth showing, and worth showing quietly. Up, it means a proposal reaches
 * the other members without anybody pasting anything. Down, it means exactly
 * one thing — copy and paste instead — and never that something is broken,
 * which is why this is a line of text rather than a warning.
 *
 * It says what it is, too. "Peer-to-peer" is doing real work in that sentence:
 * there is no server holding these proposals, so there is nobody to suspend
 * the group's account or block its endpoint, and equally nobody to keep a copy
 * for a member who was offline all week. Both halves of that follow from the
 * same fact and a member should know it.
 */
export default function TransportChip() {
  const status = useMultisigTransport((state) => state.status)
  const peers = useMultisigTransport((state) => state.peers)
  const error = useMultisigTransport((state) => state.error)

  const online = status === 'online'
  const trying = status === 'starting'

  return (
    <div className="flex flex-col gap-1 rounded-card border border-border p-4">
      <span className="flex items-center gap-2 text-base">
        {online ? (
          <RadioTower size={16} className="text-positive" />
        ) : trying ? (
          <Radio size={16} className="text-text-muted" />
        ) : (
          <WifiOff size={16} className="text-text-muted" />
        )}
        {online
          ? `Connected to the group’s channel${peers > 0 ? ` · ${peers} peer${peers === 1 ? '' : 's'}` : ''}`
          : trying
            ? 'Looking for the group’s channel…'
            : 'Not connected to the group’s channel'}
      </span>

      <p className="text-label text-text-faint">
        {online
          ? 'Proposals and signatures reach the other members on their own, over Waku. No server holds them: ' +
            'the network keeps a message for about two days, and every member’s copy re-publishes what it ' +
            'still has, so nothing is lost as long as one of you is around.'
          : 'Proposals still work — copy, download or scan them across by hand. Nothing here depends on the ' +
            'connection, and nothing that arrives over it is trusted any more than a file would be.'}
      </p>

      {error && !online ? <p className="text-label text-text-faint">Last problem: {error}</p> : null}
    </div>
  )
}

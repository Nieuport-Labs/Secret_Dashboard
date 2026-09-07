import MessageComposer from '@/pages/powertools/components/MessageComposer'

/**
 * Sending the chain whatever a form elsewhere in the app does not build.
 *
 * Composing and signing an arbitrary message is the fastest way to lose funds
 * to a typo nobody reviewed, which is exactly why every other screen builds
 * its own messages from a form. This page is the deliberate exception:
 * `secretcli` already lets someone do this, with a terminal's friction around
 * it, and a dashboard that claims to be the whole toolkit needs the same
 * escape hatch. Keplr's own confirmation screen is the backstop, the same as
 * it is for a transaction from any other screen.
 */
export default function Powertools() {
  return (
    <div className="mx-auto flex max-w-[760px] flex-col gap-10">
      <h1 className="text-display">Powertools</h1>
      <MessageComposer />
    </div>
  )
}

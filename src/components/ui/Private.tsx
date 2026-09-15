import type { ReactNode } from 'react'

import { MASK } from '@/lib/format'
import { usePrivacy } from '@/store/privacy'

/**
 * Hides what it wraps while privacy mode is on.
 *
 * For the things the formatting helpers cannot catch, because they are not
 * formatted at all: a full address printed as-is, and a QR code — which is an
 * address in a form a camera can read across a room, and therefore the single
 * worst thing to leave on screen during a screen share.
 */
export default function Private({ children, mask }: { children: ReactNode; mask?: ReactNode }) {
  const hidden = usePrivacy((state) => state.hidden)
  if (!hidden) return <>{children}</>

  /*
   * Visually neutral on purpose: it inherits the colour, the weight and the
   * letter-spacing of whatever it replaces. An earlier version set its own
   * tracking and a fainter colour, and the line visibly changed shape when the
   * eye was clicked — which makes the toggle feel like it did something to the
   * page rather than to the figure.
   */
  return (
    <span className="select-none" aria-label="Hidden">
      {mask ?? MASK}
    </span>
  )
}

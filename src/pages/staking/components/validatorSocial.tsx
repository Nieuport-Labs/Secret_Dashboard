import { Github, Globe, Linkedin, Twitter } from 'lucide-react'
import type { ReactNode } from 'react'

import type { SocialLink } from '@/lib/validatorImage'

/**
 * A validator's website and Keybase-verified social links — the small
 * presentation helpers `StakeModal` renders them with, split out of that file
 * so it isn't also carrying icon-mapping and URL-formatting logic.
 */

/** A URL for display: whatever a validator operator typed into `website` is
 *  not guaranteed to include a scheme, and the raw string is too long to sit
 *  next to an icon anyway. */
export function hostnameOf(url: string): string {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname
  } catch {
    return url
  }
}

export function withScheme(url: string): string {
  return url.startsWith('http') ? url : `https://${url}`
}

/** Keybase's own vocabulary for a proof type, not this app's — passed through
 *  for anything it doesn't have a specific icon for rather than hidden. */
export function socialIcon(type: SocialLink['type']): ReactNode {
  switch (type) {
    case 'twitter':
      return <Twitter size={15} aria-hidden />
    case 'github':
      return <Github size={15} aria-hidden />
    case 'linkedin':
      return <Linkedin size={15} aria-hidden />
    default:
      return <Globe size={15} aria-hidden />
  }
}

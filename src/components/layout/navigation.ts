import {
  ArrowLeftRight,
  Boxes,
  ChartNoAxesColumn,
  Coins,
  Activity,
  FileSignature,
  Landmark,
  Server,
  Users,
  Wallet,
  Wrench,
  type LucideIcon
} from 'lucide-react'

import type { ActingMode } from '@/store/accounts'

export interface NavItem {
  to: string
  label: string
  /**
   * What the bottom bar calls this, when the full label does not fit.
   *
   * Only the phone layout is short of room — the rail has the whole width of
   * the sidebar — so this never replaces `label` there. Set it for a label the
   * bar would otherwise clip to an ellipsis, which is worse than a shorter word.
   */
  short?: string
  icon: LucideIcon
  /** Hidden until a wallet is connected — there is nothing to show without one. */
  needsWallet?: boolean
  /** Highlight only on this exact path, for a destination that has children. */
  exact?: boolean
  /**
   * What this destination may put a dot on its icon for.
   *
   * Named rather than a boolean, because the rail cannot know what "unread"
   * means for a destination — only that this one is about proposals waiting
   * for the connected member's signature, and that `Sidebar` knows how to
   * count those.
   */
  badge?: 'unsigned-proposals'
}

/**
 * The six destinations the design names, in its order, plus governance. Bridge
 * is absent from the connected-wallet frames in Figma but present on the
 * welcome screen; it belongs in the nav either way, since bridging in is how
 * someone with an empty Secret wallet gets anything to look at.
 *
 * Governance sits next to Staking rather than at the end: voting power *is*
 * delegated stake, so the two are one subject, and a voter arriving from the
 * staking screen should not have to cross the whole rail to reach it.
 */
export const NAV_ITEMS: NavItem[] = [
  { to: '/wallet', label: 'Wallet', icon: Wallet },
  { to: '/bridge', label: 'Bridge', icon: ArrowLeftRight },
  { to: '/staking', label: 'Staking', icon: Coins },
  { to: '/governance', label: 'Governance', short: 'Gov', icon: Landmark },
  { to: '/ecosystem', label: 'Ecosystem', short: 'Apps', icon: Boxes },
  { to: '/network', label: 'Network', icon: Activity },
  { to: '/powertools', label: 'Powertools', short: 'Tools', icon: Wrench }
]

/**
 * What the rail shows while acting as a validator.
 *
 * Deliberately three destinations, not ten. Someone who switched to their
 * validator came to do validator work, and bridging, wrapping and app discovery
 * are all things they do as themselves — leaving them in would make the switch
 * decorative. Governance is the one screen both modes share, because voting is
 * the same act either way; what changes is whose weight is behind it.
 */
export const VALIDATOR_NAV_ITEMS: NavItem[] = [
  // Exact, or the overview would stay lit while Stats — its own child path — is open.
  { to: '/validator', label: 'Validator', short: 'Node', icon: Server, exact: true },
  { to: '/governance', label: 'Governance', short: 'Gov', icon: Landmark },
  { to: '/validator/stats', label: 'Stats', icon: ChartNoAxesColumn }
]

/**
 * What the rail shows while acting as a multisig.
 *
 * Shorter still than the validator's, and for the same reason: nothing here
 * can be done alone. Bridging, wrapping and buying gas are all things a single
 * key does, and offering them from a multisig would promise an immediacy the
 * account does not have — every one of them would have to become a proposal
 * and wait for a threshold. Governance stays, because a group voting together
 * is exactly what a multisig is for.
 */
export const MULTISIG_NAV_ITEMS: NavItem[] = [
  // Exact, or the overview would stay lit while a proposal is open.
  { to: '/multisig', label: 'Multisig', short: 'Group', icon: Users, exact: true },
  {
    to: '/multisig/proposals',
    label: 'Proposals',
    short: 'Props',
    icon: FileSignature,
    badge: 'unsigned-proposals'
  },
  { to: '/governance', label: 'Governance', short: 'Gov', icon: Landmark }
]

export function navItemsFor(mode: ActingMode): NavItem[] {
  if (mode === 'validator') return VALIDATOR_NAV_ITEMS
  if (mode === 'multisig') return MULTISIG_NAV_ITEMS
  return NAV_ITEMS
}

/** Where each mode's home is — what the logo links to, and where `/` lands. */
export function homeFor(mode: ActingMode): string {
  if (mode === 'validator') return '/validator'
  if (mode === 'multisig') return '/multisig'
  return '/wallet'
}

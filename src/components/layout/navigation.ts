import {
  ArrowLeftRight,
  Boxes,
  Coins,
  Activity,
  Landmark,
  Wallet,
  Wrench,
  type LucideIcon
} from 'lucide-react'

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

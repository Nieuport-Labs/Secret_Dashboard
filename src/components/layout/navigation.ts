import { ArrowLeftRight, Boxes, Coins, Activity, Wallet, Wrench, type LucideIcon } from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  /** Hidden until a wallet is connected — there is nothing to show without one. */
  needsWallet?: boolean
}

/**
 * The six destinations the design names, in its order. Bridge is absent from
 * the connected-wallet frames in Figma but present on the welcome screen; it
 * belongs in the nav either way, since bridging in is how someone with an empty
 * Secret wallet gets anything to look at.
 */
export const NAV_ITEMS: NavItem[] = [
  { to: '/wallet', label: 'Wallet', icon: Wallet },
  { to: '/bridge', label: 'Bridge', icon: ArrowLeftRight },
  { to: '/staking', label: 'Staking', icon: Coins },
  { to: '/ecosystem', label: 'Ecosystem', icon: Boxes },
  { to: '/network', label: 'Network', icon: Activity },
  { to: '/powertools', label: 'Powertools', icon: Wrench }
]

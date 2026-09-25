/**
 * The Secret ecosystem, as this dashboard lists it.
 *
 * Kept here rather than fetched from SecretFoundation/DappRegistry: the list
 * is short and hand-picked, so a change to it is a reviewed commit, and the
 * page no longer depends on a third-party file being reachable. Icons are
 * local copies for the same reason, and so browsing the page does not announce
 * which apps someone looked at.
 */

export interface Dapp {
  name: string
  link: string
  description: string
  /** Path under /img/, or absent. */
  icon?: string
  tags: string[]
}

export const DAPPS: Dapp[] = [
  {
    name: 'Secret Bridges',
    link: 'https://dash.scrt.network/bridge',
    description: 'Bridge assets from IBC, EVM, and other ecosystems to Secret.',
    icon: '/img/dapps/Bridges_Logo_2_32f36a3c58_NP9oBOxR9.webp',
    tags: ['Tool']
  },
  {
    name: 'AmberDAO',
    link: 'https://amberdao.io/',
    description: 'A community-driven, privacy-preserving store of value token built on Secret Network.',
    icon: '/img/dapps/Amber_Dao_Logo_fd192c1e11_NaDWj0aOA.webp',
    tags: ['dApp', 'DeFi']
  },
  {
    name: 'Secret Tokens',
    link: 'https://dash.scrt.network/wrap',
    description:
      'Wrapping coins as Secret Tokens immediately supercharges them with private balances and private transfers.',
    icon: '/img/dapps/stoken_2f0fb694df_bMVioaSGb.webp',
    tags: ['dApp', 'Data']
  },
  {
    name: 'Secret Dashboard (original)',
    link: 'https://dash.scrt.network/',
    description: 'An interface providing access to essential Secret Network functions and data.',
    icon: '/img/dapps/small_dashb_e1299d7523_QwkrgHrFr.webp',
    tags: ['Data']
  },
  {
    name: 'Secret Dashboard (1.9)',
    link: 'https://dashboard.nieuportlabs.cz/',
    description:
      'Send, receive, stake and wrap in one place — with private balances, invoices and tips by QR code.',
    icon: '/img/logo-mark.svg',
    tags: ['Data', 'Wallet']
  },
  {
    name: 'Shade Protocol',
    link: 'https://app.shadeprotocol.io/',
    description:
      'Private DeFi on Secret: ShadeSwap, the SILK stablecoin, lending and liquid staking with stkd-SCRT.',
    icon: '/img/dapps/dapp_shade_206fbe8b01_U9LBd0ib1-.webp',
    tags: ['dApp', 'DeFi']
  },
  {
    name: 'Keplr Wallet',
    link: 'https://wallet.keplr.app/',
    description: 'The interchain wallet for the Cosmos ecosystem.',
    icon: '/img/dapps/keplr.webp',
    tags: ['Wallet']
  },
  {
    name: 'Starshell Wallet',
    link: 'https://starshell.net/',
    description:
      'A privacy-preserving, free, and open-source Web3 wallet built for Secret Network and the Cosmos ecosystem.',
    icon: '/img/dapps/starshell.webp',
    tags: ['Wallet']
  },
  {
    name: 'Mintscan',
    link: 'https://www.mintscan.io/secret',
    description: 'A block explorer for the Cosmos ecosystem, developed by Cosmostation.',
    icon: '/img/dapps/mintscan.webp',
    tags: ['Tool']
  },
  {
    name: 'Secret Nodes',
    link: 'https://secretnodes.com/secret-4',
    description: 'A block explorer for Secret Network: blocks, transactions, validators and governance.',
    tags: ['Tool']
  },
  {
    name: 'SNIP-20 Transfer History',
    link: 'https://trivium.network/tools',
    description: 'View the transfer history of secret tokens in your wallet.',
    icon: '/img/dapps/trivium.webp',
    tags: ['Tool']
  },
  {
    name: 'Silent Swap',
    link: 'https://www.silentswap.com/',
    description: 'Private cross-chain swaps.',
    icon: '/img/dapps/silentswap.jpg',
    tags: ['Tool']
  }
]

/**
 * The app given the top of the ecosystem page. A name that must match an
 * entry above, so the card and the grid can never disagree about it.
 */
export const FEATURED_NAME = 'Secret Dashboard (1.9)'

export const FEATURED: Dapp = DAPPS.find((dapp) => dapp.name === FEATURED_NAME) ?? DAPPS[0]

/** Every tag present, in the order they first appear. */
export function collectTags(dapps: Dapp[]): string[] {
  const seen = new Set<string>()
  for (const dapp of dapps) for (const tag of dapp.tags) seen.add(tag)
  return [...seen].sort()
}

/**
 * Where to get SCRT.
 *
 * Deliberately a short, checkable list rather than an exhaustive one. Someone
 * who has none needs a next step, not a directory.
 */
export const WHERE_TO_BUY = [
  {
    name: 'Osmosis',
    link: 'https://app.osmosis.zone/?from=USDC&to=SCRT',
    detail: 'Swap on-chain from any Cosmos asset. No account, no sign-up.'
  },
  {
    name: 'Kraken',
    link: 'https://www.kraken.com/prices/secret',
    detail: 'Buy with a bank transfer or card, then withdraw to your own address.'
  },
  {
    name: 'Bridge from another chain',
    link: '/bridge',
    detail: 'Already hold something on Cosmos Hub, Osmosis or Injective? Bring it over.',
    internal: true
  }
]

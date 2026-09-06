/**
 * Chains this dashboard can bridge to and from.
 *
 * Adapted from dash.scrt.network's chain table (MIT). Axelar's own routes are
 * absent on purpose: they have been disabled since the 2026-06-10 drain of the
 * CW20-ICS20 fork, and the reference still ships them. See docs/chain-facts.md.
 *
 * Channel ids are the part that rots. `withdrawChannel` is Secret's own side and
 * is checked by `npm run verify:chain`; `depositChannel` belongs to the source
 * chain and is verified against that chain when a route is selected, because
 * checking thirty-seven chains on every page load would be absurd.
 */

export interface SourceChain {
  name: string
  chainId: string
  /** bech32 prefix, used to derive this chain's address from the same key. */
  prefix: string
  /** Channel on the source chain that carries tokens to Secret. */
  depositChannel: string
  /** Channel on Secret that carries tokens back. */
  withdrawChannel: string
  /**
   * This chain's own channel to Osmosis — the first hop "Get gas" needs to
   * reach the swap contract. Absent on purpose everywhere but Osmosis and the
   * handful of chains it has actually been verified for: the gas leg's packet
   * is addressed to an `osmo1…` contract, and sending it over `depositChannel`
   * (which the code did before this field existed) puts that packet on the
   * chain's ordinary route to *Secret* instead — where an `osmo1` receiver
   * cannot be credited, and the packet fails rather than reaching the swap. A
   * missing value here is what keeps "Get gas" from being offered at all for a
   * chain nobody has checked, rather than offering it and letting the packet
   * fail after the user has already signed.
   */
  osmosisChannel?: string
  depositGas: number
  withdrawGas: number
  /** Denomination fees are paid in on the source chain. */
  feeDenom: string
  /** File under /img/chains/. */
  image: string
  rpc: string
  lcd: string
}

export const SOURCE_CHAINS: SourceChain[] = [
  {
    name: 'Agoric',
    chainId: 'agoric-3',
    prefix: 'agoric',
    depositChannel: 'channel-10',
    withdrawChannel: 'channel-51',
    depositGas: 200000,
    withdrawGas: 150000,
    feeDenom: 'ubld',
    image: 'bld.svg',
    rpc: 'https://main.rpc.agoric.net',
    lcd: 'https://main.api.agoric.net'
  },
  {
    name: 'Akash',
    chainId: 'akashnet-2',
    prefix: 'akash',
    depositChannel: 'channel-43',
    withdrawChannel: 'channel-21',
    depositGas: 200000,
    withdrawGas: 150000,
    feeDenom: 'uakt',
    image: 'akt.svg',
    rpc: 'https://rpc.lavenderfive.com/akash',
    lcd: 'https://rest.lavenderfive.com/akash'
  },
  {
    name: 'Andromeda',
    chainId: 'andromeda-1',
    prefix: 'andr',
    depositChannel: 'channel-2',
    withdrawChannel: 'channel-97',
    depositGas: 200000,
    withdrawGas: 150000,
    feeDenom: 'uandr',
    image: 'andr.png',
    rpc: 'https://andro.rpc.m.stavr.tech',
    lcd: 'https://andro.api.m.stavr.tech'
  },
  {
    name: 'Archway',
    chainId: 'archway-1',
    prefix: 'archway',
    depositChannel: 'channel-21',
    withdrawChannel: 'channel-84',
    depositGas: 200000,
    withdrawGas: 150000,
    feeDenom: 'aarch',
    image: 'archway.svg',
    rpc: 'https://rpc.lavenderfive.com/archway',
    lcd: 'https://rest.lavenderfive.com/archway'
  },
  {
    name: 'Axelar',
    chainId: 'axelar-dojo-1',
    prefix: 'axelar',
    depositChannel: 'channel-12',
    withdrawChannel: 'channel-20',
    depositGas: 200000,
    withdrawGas: 150000,
    feeDenom: 'uaxl',
    image: 'axl.svg',
    rpc: 'https://rpc-axelar.imperator.co:443',
    lcd: 'https://lcd-axelar.imperator.co:443'
  },
  {
    name: 'Carbon',
    chainId: 'carbon-1',
    prefix: 'swth',
    depositChannel: 'channel-45',
    withdrawChannel: 'channel-160',
    depositGas: 200000,
    withdrawGas: 150000,
    feeDenom: 'swth',
    image: 'swth.svg',
    rpc: 'https://rpc.lavenderfive.com/carbon',
    lcd: 'https://rest.lavenderfive.com/carbon'
  },
  {
    name: 'Celestia',
    chainId: 'celestia',
    prefix: 'celestia',
    depositChannel: 'channel-14',
    withdrawChannel: 'channel-91',
    depositGas: 200000,
    withdrawGas: 150000,
    feeDenom: 'utia',
    image: 'celestia.svg',
    rpc: 'https://rpc.lavenderfive.com/celestia',
    lcd: 'https://rest.lavenderfive.com/celestia'
  },
  {
    name: 'Comdex',
    chainId: 'comdex-1',
    prefix: 'comdex',
    depositChannel: 'channel-65',
    withdrawChannel: 'channel-63',
    depositGas: 200000,
    withdrawGas: 150000,
    feeDenom: 'ucmdx',
    image: 'cmdx.svg',
    rpc: 'https://rpc.lavenderfive.com/comdex',
    lcd: 'https://rest.lavenderfive.com/comdex'
  },
  {
    name: 'Composable',
    chainId: 'centauri-1',
    prefix: 'pica',
    depositChannel: 'channel-14',
    withdrawChannel: 'channel-80',
    depositGas: 200000,
    withdrawGas: 150000,
    feeDenom: 'ppica',
    image: 'composable.svg',
    rpc: 'https://rpc.lavenderfive.com/composable',
    lcd: 'https://rest.lavenderfive.com/composable'
  },
  {
    name: 'Coreum',
    chainId: 'coreum-mainnet-1',
    prefix: 'core',
    depositChannel: 'channel-25',
    withdrawChannel: 'channel-101',
    depositGas: 300000,
    withdrawGas: 150000,
    feeDenom: 'ucore',
    image: 'coreum.svg',
    rpc: 'https://rpc-coreum.ecostake.com',
    lcd: 'https://rest-coreum.ecostake.com'
  },
  {
    name: 'Cosmos Hub',
    chainId: 'cosmoshub-4',
    prefix: 'cosmos',
    depositChannel: 'channel-235',
    withdrawChannel: 'channel-0',
    depositGas: 200000,
    withdrawGas: 150000,
    feeDenom: 'uatom',
    image: 'atom.svg',
    rpc: 'https://rpc.lavenderfive.com/cosmoshub',
    lcd: 'https://rest.lavenderfive.com/cosmoshub'
  },
  {
    name: 'dYdX',
    chainId: 'dydx-mainnet-1',
    prefix: 'dydx',
    depositChannel: 'channel-2',
    withdrawChannel: 'channel-89',
    depositGas: 250000,
    withdrawGas: 150000,
    feeDenom: 'adydx',
    image: 'dydx.svg',
    rpc: 'https://rpc.lavenderfive.com/dydx',
    lcd: 'https://rest.lavenderfive.com/dydx'
  },
  {
    name: 'Dymension',
    chainId: 'dymension_1100-1',
    prefix: 'dym',
    depositChannel: 'channel-35',
    withdrawChannel: 'channel-130',
    depositGas: 250000,
    withdrawGas: 150000,
    feeDenom: 'adym',
    image: 'dymension.svg',
    rpc: 'https://rpc.lavenderfive.com/dymension',
    lcd: 'https://rest.lavenderfive.com/dymension'
  },
  {
    name: 'Gravity Bridge',
    chainId: 'gravity-bridge-3',
    prefix: 'gravity',
    depositChannel: 'channel-79',
    withdrawChannel: 'channel-17',
    depositGas: 200000,
    withdrawGas: 150000,
    feeDenom: 'ugraviton',
    image: 'grav.svg',
    rpc: 'https://gravity-rpc.polkachu.com',
    lcd: 'https://gravity-api.polkachu.com'
  },
  {
    name: 'Cheqd',
    chainId: 'cheqd-mainnet-1',
    prefix: 'cheqd',
    depositChannel: 'channel-36',
    withdrawChannel: 'channel-141',
    depositGas: 200000,
    withdrawGas: 150000,
    feeDenom: 'ncheq',
    image: 'cheq.svg',
    rpc: 'https://rpc.lavenderfive.com/cheqd',
    lcd: 'https://rest.lavenderfive.com/cheqd'
  },
  {
    name: 'Chihuahua',
    chainId: 'chihuahua-1',
    prefix: 'chihuahua',
    depositChannel: 'channel-16',
    withdrawChannel: 'channel-11',
    depositGas: 200000,
    withdrawGas: 150000,
    feeDenom: 'uhuahua',
    image: 'huahua.svg',
    rpc: 'https://rpc.lavenderfive.com/chihuahua',
    lcd: 'https://rest.lavenderfive.com/chihuahua'
  },
  {
    name: 'Injective',
    chainId: 'injective-1',
    prefix: 'inj',
    depositChannel: 'channel-88',
    withdrawChannel: 'channel-23',
    depositGas: 350000,
    withdrawGas: 150000,
    feeDenom: 'inj',
    image: 'inj.svg',
    rpc: 'https://rpc.lavenderfive.com/injective',
    lcd: 'https://rest.lavenderfive.com/injective'
  },
  {
    name: 'Jackal',
    chainId: 'jackal-1',
    prefix: 'jkl',
    depositChannel: 'channel-2',
    withdrawChannel: 'channel-62',
    depositGas: 200000,
    withdrawGas: 150000,
    feeDenom: 'ujkl',
    image: 'jkl.svg',
    rpc: 'https://rpc.lavenderfive.com/jackal',
    lcd: 'https://rest.lavenderfive.com/jackal'
  },
  {
    name: 'Juno',
    chainId: 'juno-1',
    prefix: 'juno',
    depositChannel: 'channel-48',
    withdrawChannel: 'channel-8',
    depositGas: 150000,
    withdrawGas: 150000,
    feeDenom: 'ujuno',
    image: 'juno.svg',
    rpc: 'https://rpc.lavenderfive.com/juno',
    lcd: 'https://rest.lavenderfive.com/juno'
  },
  {
    name: 'Kava',
    chainId: 'kava_2222-10',
    prefix: 'kava',
    depositChannel: 'channel-148',
    withdrawChannel: 'channel-158',
    depositGas: 200000,
    withdrawGas: 150000,
    feeDenom: 'ukava',
    image: 'kava.svg',
    rpc: 'https://kava-rpc.publicnode.com',
    lcd: 'https://kava-rest.publicnode.com'
  },
  {
    name: 'Kujira',
    chainId: 'kaiyo-1',
    prefix: 'kujira',
    depositChannel: 'channel-10',
    withdrawChannel: 'channel-22',
    depositGas: 200000,
    withdrawGas: 150000,
    feeDenom: 'ukuji',
    image: 'kuji.svg',
    rpc: 'https://kujira-rpc.polkachu.com',
    lcd: 'https://kujira-api.polkachu.com'
  },
  {
    name: 'Migaloo',
    chainId: 'migaloo-1',
    prefix: 'migaloo',
    depositChannel: 'channel-4',
    withdrawChannel: 'channel-57',
    depositGas: 200000,
    withdrawGas: 150000,
    feeDenom: 'uwhale',
    image: 'migaloo.svg',
    rpc: 'https://migaloo-rpc.polkachu.com:443',
    lcd: 'https://migaloo-api.polkachu.com:443'
  },
  {
    name: 'Neutron',
    chainId: 'neutron-1',
    prefix: 'neutron',
    depositChannel: 'channel-1551',
    withdrawChannel: 'channel-144',
    depositGas: 200000,
    withdrawGas: 150000,
    feeDenom: 'untrn',
    image: 'ntrn.svg',
    rpc: 'https://rpc-kralum.neutron-1.neutron.org',
    lcd: 'https://rest-kralum.neutron-1.neutron.org'
  },
  {
    name: 'Noble',
    chainId: 'noble-1',
    prefix: 'noble',
    depositChannel: 'channel-17',
    withdrawChannel: 'channel-88',
    // Noble's own channel-1, STATE_OPEN, counterparty channel-750 on a client
    // reporting osmosis-1 — checked directly against Noble's LCD, not taken
    // from the chain-registry's `preferred` flag alone. See chain-facts.md.
    osmosisChannel: 'channel-1',
    depositGas: 200000,
    withdrawGas: 150000,
    feeDenom: 'uusdc',
    image: 'noble.svg',
    rpc: 'https://noble-rpc.polkachu.com',
    lcd: 'https://noble-api.polkachu.com'
  },
  {
    name: 'Nolus',
    chainId: 'pirin-1',
    prefix: 'nolus',
    depositChannel: 'channel-13995',
    withdrawChannel: 'channel-146',
    depositGas: 200000,
    withdrawGas: 150000,
    feeDenom: 'unls',
    image: 'nolus.svg',
    rpc: 'https://rpc.lavenderfive.com/nolus',
    lcd: 'https://rest.lavenderfive.com/nolus'
  },
  {
    name: 'Nym',
    chainId: 'nyx',
    prefix: 'n',
    depositChannel: 'channel-12',
    withdrawChannel: 'channel-174',
    depositGas: 200000,
    withdrawGas: 150000,
    feeDenom: 'unym',
    image: 'nyx.png',
    rpc: 'https://rpc.nymtech.net/',
    lcd: 'https://api.nymtech.net'
  },
  {
    name: 'Omniflix',
    chainId: 'omniflixhub-1',
    prefix: 'omniflix',
    depositChannel: 'channel-46',
    withdrawChannel: 'channel-162',
    depositGas: 500000,
    withdrawGas: 150000,
    feeDenom: 'uflix',
    image: 'flix.svg',
    rpc: 'https://rpc.omniflix.bronbro.io:443',
    lcd: 'https://lcd.omniflix.bronbro.io'
  },
  {
    name: 'Oraichain',
    chainId: 'Oraichain',
    prefix: 'orai',
    depositChannel: 'channel-217',
    withdrawChannel: 'channel-135',
    depositGas: 700000,
    withdrawGas: 150000,
    feeDenom: 'orai',
    image: 'orai.svg',
    rpc: 'https://rpc.orai.io',
    lcd: 'https://lcd.orai.io'
  },
  {
    name: 'Osmosis',
    chainId: 'osmosis-1',
    prefix: 'osmo',
    depositChannel: 'channel-88',
    withdrawChannel: 'channel-1',
    depositGas: 700000,
    withdrawGas: 150000,
    feeDenom: 'uosmo',
    image: 'osmo.svg',
    rpc: 'https://osmosis-rpc.publicnode.com',
    lcd: 'https://osmosis-rest.publicnode.com'
  },
  {
    name: 'Persistence',
    chainId: 'core-1',
    prefix: 'persistence',
    depositChannel: 'channel-82',
    withdrawChannel: 'channel-64',
    depositGas: 300000,
    withdrawGas: 150000,
    feeDenom: 'uxprt',
    image: 'xprt.svg',
    rpc: 'https://persistence-rpc.publicnode.com',
    lcd: 'https://persistence-rest.publicnode.com'
  },
  {
    name: 'Quicksilver',
    chainId: 'quicksilver-2',
    prefix: 'quick',
    depositChannel: 'channel-52',
    withdrawChannel: 'channel-65',
    depositGas: 300000,
    withdrawGas: 150000,
    feeDenom: 'uqck',
    image: 'qck.svg',
    rpc: 'https://rpc.lavenderfive.com/quicksilver',
    lcd: 'https://rest.lavenderfive.com/quicksilver'
  },
  {
    name: 'Saga',
    chainId: 'ssc-1',
    prefix: 'saga',
    depositChannel: 'channel-17',
    withdrawChannel: 'channel-152',
    depositGas: 200000,
    withdrawGas: 150000,
    feeDenom: 'usaga',
    image: 'saga.svg',
    rpc: 'https://saga-rpc.publicnode.com',
    lcd: 'https://saga-rest.publicnode.com'
  },
  {
    name: 'Sentinel',
    chainId: 'sentinelhub-2',
    prefix: 'sent',
    depositChannel: 'channel-50',
    withdrawChannel: 'channel-3',
    depositGas: 200000,
    withdrawGas: 150000,
    feeDenom: 'udvpn',
    image: 'dvpn.svg',
    rpc: 'https://rpc-sentinel.whispernode.com:443',
    lcd: 'https://lcd-sentinel.whispernode.com:443'
  },
  {
    name: 'Stargaze',
    chainId: 'stargaze-1',
    prefix: 'stars',
    depositChannel: 'channel-48',
    withdrawChannel: 'channel-19',
    depositGas: 200000,
    withdrawGas: 150000,
    feeDenom: 'ustars',
    image: 'stars.svg',
    rpc: 'https://rpc.stargaze-apis.com',
    lcd: 'https://rest.stargaze-apis.com'
  },
  {
    name: 'Stride',
    chainId: 'stride-1',
    prefix: 'stride',
    depositChannel: 'channel-40',
    withdrawChannel: 'channel-37',
    depositGas: 200000,
    withdrawGas: 150000,
    feeDenom: 'ustrd',
    image: 'stride.svg',
    rpc: 'https://rpc.lavenderfive.com/stride',
    lcd: 'https://rest.lavenderfive.com/stride'
  },
  {
    name: 'Terra',
    chainId: 'phoenix-1',
    prefix: 'terra',
    depositChannel: 'channel-3',
    withdrawChannel: 'channel-16',
    depositGas: 300000,
    withdrawGas: 150000,
    feeDenom: 'uluna',
    image: 'luna2.svg',
    rpc: 'https://terra-rpc.publicnode.com',
    lcd: 'https://terra-rest.publicnode.com'
  },
  {
    name: 'UX Chain',
    chainId: 'umee-1',
    prefix: 'umee',
    depositChannel: 'channel-123',
    withdrawChannel: 'channel-126',
    depositGas: 200000,
    withdrawGas: 150000,
    feeDenom: 'uumee',
    image: 'umee.svg',
    rpc: 'https://umee-rpc.w3coins.io',
    lcd: 'https://umee-api.w3coins.io'
  }
]

const BY_ID = new Map(SOURCE_CHAINS.map((chain) => [chain.chainId, chain]))

export function sourceChain(chainId: string): SourceChain | undefined {
  return BY_ID.get(chainId)
}

export function chainImageUrl(chain: SourceChain): string {
  return `/img/chains/${chain.image}`
}

/** Osmosis is the swap hop for "Get gas", so it is looked up by name elsewhere. */
export const OSMOSIS_CHAIN_ID = 'osmosis-1'

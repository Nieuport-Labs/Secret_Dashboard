/**
 * Chains this dashboard can bridge to and from.
 *
 * Adapted from dash.scrt.network's chain table (MIT). Axelar's own routes are
 * absent on purpose: they have been disabled since the 2026-06-10 drain of the
 * CW20-ICS20 fork, and the reference still ships them. See docs/chain-facts.md.
 * Twenty smaller chains the reference lists are left out too, to keep the
 * picker short. Their token routes stay in `tokens/routes.ts`: that table also
 * says which bank denomination each token wraps, and someone already holding
 * one of those tokens on Secret still needs to wrap and unwrap it.
 *
 * Channel ids are the part that rots. `withdrawChannel` is Secret's own side and
 * is checked by `npm run verify:chain`; `depositChannel` belongs to the source
 * chain and is verified against that chain when a route is selected, because
 * checking seventeen chains on every page load would be absurd.
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
    name: 'Noble',
    chainId: 'noble-1',
    prefix: 'noble',
    depositChannel: 'channel-17',
    withdrawChannel: 'channel-88',
    depositGas: 200000,
    withdrawGas: 150000,
    feeDenom: 'uusdc',
    image: 'noble.svg',
    rpc: 'https://noble-rpc.polkachu.com',
    lcd: 'https://noble-api.polkachu.com'
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

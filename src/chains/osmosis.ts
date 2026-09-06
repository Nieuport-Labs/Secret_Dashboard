/**
 * Osmosis, used only as the swap hop for "Get gas" at bridge time.
 *
 * Someone arriving on Secret with no SCRT cannot sign anything — not even the
 * transaction that would get them gas. So the swap and the credit purchase have
 * to happen in flight, carried by the IBC packet, with no Secret-side signature
 * from the user. Osmosis is where the swap happens on the way through.
 *
 * Every address here was resolved by querying the chain. The address most
 * commonly quoted online for crosschain-swaps does not exist on mainnet; see
 * docs/chain-facts.md.
 */

import type { SourceChain } from '@/chains/sources'

export const OSMOSIS_CHAIN_ID = 'osmosis-1'
export const OSMOSIS_BECH32_PREFIX = 'osmo'

export const OSMOSIS_LCD_URLS = ['https://lcd.osmosis.zone']

/** SCRT as it exists on Osmosis: `transfer/channel-88/uscrt`. */
export const SCRT_ON_OSMOSIS = 'ibc/0954E1C28EB7AF5B72D24F3BC2B47BBB2FDF91BDDFD57B74B99E133AED40972A'

/** Osmosis → Secret. Its counterparty client reports `secret-4`. */
export const OSMOSIS_TO_SECRET_CHANNEL = 'channel-88'

/**
 * Crosschain swaps: takes tokens in over IBC, swaps them, forwards the result
 * to a receiver on a third chain, optionally attaching `next_memo` for that
 * chain's own hooks.
 *
 * Labelled `CrossChainSwaps v1.2` (code 37). Whether that lineage exposes
 * `next_memo` and automatic unwinding must be read from its schema before the
 * Get-gas flow is built on it — route planning goes through `@skip-go/client`
 * either way, and this is the fallback.
 */
export const CROSSCHAIN_SWAPS_CONTRACT = 'osmo1uwk8xc6q0s6t5qcpr6rht3sczu6du83xq8pwxjua0hfj5hzcnh3sqxwvxs'

/** Default size of the gas slice taken out of a bridged amount, in USD. */
export const GAS_SLICE_USD = 1

/**
 * Below this the "Get gas" option is not offered: taking a dollar out of three
 * bridged dollars is not a service. The bridged amount must be at least this
 * many times the gas slice.
 */
export const GAS_SLICE_MIN_RATIO = 5

/**
 * The channel a deposit's gas leg should travel over to reach Osmosis, or
 * `undefined` when this chain has no verified one.
 *
 * Depositing directly from Osmosis needs no hop at all — the swap contract is
 * already on the chain the packet starts on, so this returns the *deposit*
 * route's own channel to Secret's `depositRoute`, same as the main leg.
 * Everywhere else it is `chain.osmosisChannel`, which only a handful of chains
 * carry: see the comment on that field for why an absent value disables the
 * feature rather than guessing `depositChannel`, which goes to Secret, not to
 * Osmosis, and sends the gas leg's `osmo1…`-addressed packet nowhere useful.
 */
export function osmosisRouteChannel(chain: SourceChain, depositChannel?: string): string | undefined {
  if (chain.chainId === OSMOSIS_CHAIN_ID) return depositChannel ?? chain.depositChannel
  return chain.osmosisChannel
}

/** Whether "Get gas" can even be attempted from this chain, channel-wise. */
export function canRouteToOsmosis(chain: SourceChain): boolean {
  return chain.chainId === OSMOSIS_CHAIN_ID || Boolean(chain.osmosisChannel)
}

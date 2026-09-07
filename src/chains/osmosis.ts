/**
 * Osmosis, used only as the swap hop for "Get gas" at bridge time.
 *
 * Someone arriving on Secret with no SCRT cannot sign anything — not even the
 * transaction that would get them gas. So the swap has to happen in flight,
 * carried by the IBC packet, with no Secret-side signature from the user.
 * Osmosis is where the swap happens on the way through — which chain it is,
 * and which channel it uses, is decided fresh per request by Skip's routing
 * API (`lib/skipGo.ts`) rather than fixed here. The one exception is
 * `OSMOSIS_CHAIN_ID`, needed to recognise the two-chain case: depositing
 * directly from Osmosis, where the swap needs no hop at all.
 *
 * This file used to also carry a hand-maintained Osmosis contract address and
 * a per-chain channel table for reaching it. Both are gone: that contract
 * resolved a receiver through a governor-only pool list that only ever
 * covered `OSMO → SCRT`, and a live packet bridging USDC failed with "No
 * route found" for exactly that reason. See docs/chain-facts.md.
 */

export const OSMOSIS_CHAIN_ID = 'osmosis-1'
export const OSMOSIS_BECH32_PREFIX = 'osmo'

export const OSMOSIS_LCD_URLS = ['https://lcd.osmosis.zone']

/** Default size of the gas slice taken out of a bridged amount, in USD. */
export const GAS_SLICE_USD = 1

/**
 * Below this the "Get gas" option is not offered: taking a dollar out of three
 * bridged dollars is not a service. The bridged amount must be at least this
 * many times the gas slice.
 */
export const GAS_SLICE_MIN_RATIO = 5

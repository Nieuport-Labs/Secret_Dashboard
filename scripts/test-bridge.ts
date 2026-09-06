/**
 * Tests for the bridge's pure logic: how much of someone's money the gas slice
 * takes, and the exact shape of the memos that move it.
 *
 * Plain Node through --experimental-strip-types, no bundler and no test
 * framework, matching verify-chain.ts. A flat list of assertions; comment out a
 * `check(...)` to run a subset.
 *
 *   npm run test:bridge
 */

import { quoteGasSlice, shouldOfferGas, buildGasLeg, fittingGasSliceUsd } from '../src/lib/getGas.ts'
import { gasCreditMemo, wrapDepositMemo, osmosisSwapToSecretMemo } from '../src/lib/ibcMemo.ts'
import { GAS_VAULT_ADDRESS, IBC_HOOKS_WRAPPER } from '../src/chains/secret4.ts'
import {
  CROSSCHAIN_SWAPS_CONTRACT,
  OSMOSIS_TO_SECRET_CHANNEL,
  SCRT_ON_OSMOSIS,
  canRouteToOsmosis,
  osmosisRouteChannel
} from '../src/chains/osmosis.ts'
import { SOURCE_CHAINS } from '../src/chains/sources.ts'

let passed = 0
let failed = 0

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1
    return
  }
  failed += 1
  console.log(`FAIL  ${name}`)
  if (detail !== undefined) console.log(`      ${JSON.stringify(detail)}`)
}

const USER = 'secret1kkmu4vydkppkhzmx00glm20vn47t09544adv0g'
const OSMO = 'osmo1kkmu4vydkppkhzmx00glm20vn47t09544qc3fkt'

/* -------------------------------------------------------------------------- */
/* Slice sizing                                                                */
/* -------------------------------------------------------------------------- */

// 1 USD of SCRT at $0.25 is 4 SCRT; 1 USD of a $10 token is 0.1 of it.
const quote = quoteGasSlice({
  targetUsd: 1,
  scrtPrice: 0.25,
  tokenPrice: 10,
  tokenDecimals: 6,
  bridgeAmountBaseUnits: '100000000' // 100 tokens
})

check('sizes the SCRT side', quote?.amountBaseUnits === '4000000', quote)
check('sizes the cost side', quote?.costBaseUnits === '100000', quote)
check('formats for display', quote?.amountScrt === '4', quote)

// Decimals are the token's, not a fixed 6. An 18-decimal token must not be
// billed as if it had 6, which would overcharge by a factor of a trillion.
const eighteen = quoteGasSlice({
  targetUsd: 1,
  scrtPrice: 0.25,
  tokenPrice: 2000,
  tokenDecimals: 18,
  bridgeAmountBaseUnits: '1000000000000000000'
})
check('respects token decimals', eighteen?.costBaseUnits === '500000000000000', eighteen)

// A missing price must never be guessed around.
check(
  'no price, no slice',
  quoteGasSlice({
    targetUsd: 1,
    scrtPrice: undefined,
    tokenPrice: 10,
    tokenDecimals: 6,
    bridgeAmountBaseUnits: '100000000'
  }) === undefined
)
check(
  'zero price, no slice',
  quoteGasSlice({
    targetUsd: 1,
    scrtPrice: 0,
    tokenPrice: 10,
    tokenDecimals: 6,
    bridgeAmountBaseUnits: '100000000'
  }) === undefined
)

// The slice can never exceed what is being bridged.
check(
  'slice larger than the transfer is refused',
  quoteGasSlice({
    targetUsd: 1,
    scrtPrice: 0.25,
    tokenPrice: 10,
    tokenDecimals: 6,
    bridgeAmountBaseUnits: '1000' // 0.001 token, worth a cent
  }) === undefined
)

/* -------------------------------------------------------------------------- */
/* Whether to offer                                                            */
/* -------------------------------------------------------------------------- */

const plenty = shouldOfferGas('5000000', quote, '100000000') // 5 SCRT held
check('not offered when the wallet has enough', plenty.offer === false && plenty.reason === 'has-enough')

const someButLow = shouldOfferGas('500000', quote, '100000000') // 0.5 SCRT
check('offered below one SCRT', someButLow.offer === true)
check('not urgent when some SCRT is held', someButLow.offer === true && someButLow.urgent === false)

const empty = shouldOfferGas('0', quote, '100000000')
check('urgent at exactly zero', empty.offer === true && empty.urgent === true)
check('undefined balance counts as zero', shouldOfferGas(undefined, quote, '100000000').offer === true)

// Ratio guard: taking $1 out of $3 is not a service.
const tiny = shouldOfferGas('0', quote, '300000') // 0.3 token = $3, slice costs $1
check(
  'refused when the transfer is barely larger than the slice',
  tiny.offer === false && tiny.reason === 'amount-too-small'
)

const justEnough = shouldOfferGas('0', quote, '500000') // exactly 5x
check('allowed at exactly the five-times floor', justEnough.offer === true)

const priceless = shouldOfferGas('0', undefined, '100000000')
check('no price means no offer', priceless.offer === false && priceless.reason === 'no-price')

/*
 * Regression: a wallet with 2 AKT (~$1.13 at the prices this was reported
 * with) and no SCRT saw "Get gas" greyed out with copy that flatly claimed it
 * was "not" short of gas. The ratio guard above was correct to refuse the
 * slice — taking $1 out of $1.13 is not a service — but the panel had no way
 * to say why, or to offer a size that would actually work. `fittingGasSliceUsd`
 * is what "Take less" now calls instead of a blind divide-by-four.
 */
const smallTransfer = shouldOfferGas('0', quote, '113000') // 0.113 token ≈ $1.13
check(
  'reproduces the reported amount-too-small case',
  smallTransfer.offer === false && smallTransfer.reason === 'amount-too-small',
  smallTransfer
)

const fitted = fittingGasSliceUsd(1, 0.25, 10, 6, '113000')
const refitted = quoteGasSlice({
  targetUsd: fitted,
  scrtPrice: 0.25,
  tokenPrice: 10,
  tokenDecimals: 6,
  bridgeAmountBaseUnits: '113000'
})
check(
  'the fitted target actually clears the ratio check it was refused on',
  shouldOfferGas('0', refitted, '113000').offer === true,
  { fitted, refitted }
)

// A transfer worth less than the floor slice has no fitting size to find.
// The function must still return something usable rather than looping forever
// or producing NaN.
const hopeless = fittingGasSliceUsd(1, 0.25, 10, 6, '100')
check('gives up at the floor rather than hanging', hopeless === 0.02, hopeless)

/* -------------------------------------------------------------------------- */
/* Memo shapes                                                                 */
/* -------------------------------------------------------------------------- */

/*
 * Secret's ibc-hooks requires receiver == memo.wasm.contract. Every one of these
 * asserts that pairing, because setting them independently produces a packet
 * that arrives and quietly does nothing.
 */

const wrap = wrapDepositMemo('secret1token', 'deadbeef', USER)
const wrapParsed = JSON.parse(wrap.memo) as { wasm: { contract: string; msg: Record<string, unknown> } }
check('wrap memo is addressed to the hook contract', wrap.receiver === IBC_HOOKS_WRAPPER)
check('wrap receiver equals wasm.contract', wrap.receiver === wrapParsed.wasm.contract)
check('wrap carries the recipient inside the message', JSON.stringify(wrapParsed.wasm.msg).includes(USER))

const credit = gasCreditMemo(USER)
const creditParsed = JSON.parse(credit.memo) as {
  wasm: { contract: string; msg: { grant: { grantee: string } } }
}
check('credit memo is addressed to the vault', credit.receiver === GAS_VAULT_ADDRESS)
check('credit receiver equals wasm.contract', credit.receiver === creditParsed.wasm.contract)
check('credit names the user as grantee, not as receiver', creditParsed.wasm.msg.grant.grantee === USER)

const swap = osmosisSwapToSecretMemo({ secretReceiver: USER, recoveryAddress: OSMO })
const swapParsed = JSON.parse(swap.memo) as {
  wasm: {
    contract: string
    msg: {
      osmosis_swap: {
        output_denom: string
        receiver: string
        on_failed_delivery: { local_recovery_addr?: string }
        next_memo: unknown
      }
    }
  }
}
check('swap is addressed to the crosschain contract', swap.receiver === CROSSCHAIN_SWAPS_CONTRACT)
check('swap receiver equals wasm.contract', swap.receiver === swapParsed.wasm.contract)
check(
  'swap outputs SCRT as Osmosis knows it',
  swapParsed.wasm.msg.osmosis_swap.output_denom === SCRT_ON_OSMOSIS
)
check(
  'failed delivery is always recoverable, never do_nothing',
  swapParsed.wasm.msg.osmosis_swap.on_failed_delivery.local_recovery_addr === OSMO
)

/* -------------------------------------------------------------------------- */
/* The two deliveries                                                          */
/* -------------------------------------------------------------------------- */

const native = buildGasLeg({ secretAddress: USER, osmosisAddress: OSMO, delivery: 'native' })
const nativeInner = JSON.parse(native.memo) as {
  wasm: { msg: { osmosis_swap: { receiver: string; next_memo: unknown } } }
}
check(
  'native delivery sends SCRT to the user, addressed explicitly by channel',
  nativeInner.wasm.msg.osmosis_swap.receiver === `ibc:${OSMOSIS_TO_SECRET_CHANNEL}/${USER}`
)
check('native delivery runs no hook on Secret', nativeInner.wasm.msg.osmosis_swap.next_memo === null)

const credits = buildGasLeg({ secretAddress: USER, osmosisAddress: OSMO, delivery: 'credits' })
const creditsInner = JSON.parse(credits.memo) as {
  wasm: { msg: { osmosis_swap: { receiver: string; next_memo: { wasm: { contract: string } } } } }
}
/*
 * Regression: a live send with a bare `secret1…` receiver here failed with
 * "invalid receiver". The deployed crosschain-swaps contract (v0.1.0, read
 * from its own on-chain state — see docs/chain-facts.md) resolves a bare
 * address through an internal CHANNEL_MAP keyed by bech32 prefix, and that
 * map was never given an entry for `secret`. `ibc:channel-<n>/<addr>` is the
 * contract's *other* receiver format, which the same source shows bypasses
 * that map entirely and is used as given.
 */
check(
  'the receiver is explicit — channel-88, not a bare address the deployed contract cannot resolve',
  creditsInner.wasm.msg.osmosis_swap.receiver === `ibc:${OSMOSIS_TO_SECRET_CHANNEL}/${GAS_VAULT_ADDRESS}`
)
check(
  'credit delivery nests the hook in next_memo, the slot that reaches Secret',
  creditsInner.wasm.msg.osmosis_swap.next_memo.wasm.contract === GAS_VAULT_ADDRESS
)

/* -------------------------------------------------------------------------- */
/* Routing the gas leg to Osmosis, not to Secret                              */
/* -------------------------------------------------------------------------- */

/*
 * Regression: a live deposit of 4 USDC from Noble with both Wrap and Get gas
 * checked wrapped correctly but never delivered gas. The gas leg's receiver is
 * an `osmo1…` swap contract, and the code sent that packet over whatever
 * channel a chain other than Osmosis itself happened to have on hand — which,
 * before `osmosisChannel` existed as a field, was `chain.depositChannel`: the
 * ordinary route to *Secret*. Secret cannot credit an `osmo1` receiver, so the
 * packet failed while the unrelated wrap packet, sent separately, succeeded on
 * its own. These assertions pin both halves of the fix: a chain without a
 * verified route must not be treated as routable, and a chain that has one
 * must route over *that* channel rather than its deposit channel to Secret.
 */

const noble = SOURCE_CHAINS.find((c) => c.chainId === 'noble-1')
const osmosisChain = SOURCE_CHAINS.find((c) => c.chainId === 'osmosis-1')
const akash = SOURCE_CHAINS.find((c) => c.chainId === 'akashnet-2')
if (!noble || !osmosisChain || !akash) {
  throw new Error('fixture chains missing from SOURCE_CHAINS — check chain ids')
}

check('Osmosis itself is always routable', canRouteToOsmosis(osmosisChain))
check('Noble is routable — it carries a verified osmosisChannel', canRouteToOsmosis(noble))
check(
  'a chain with no verified osmosisChannel is not routable',
  canRouteToOsmosis(akash) === false,
  akash.osmosisChannel
)

check(
  "Noble's gas leg travels its own channel to Osmosis, not its deposit channel to Secret",
  osmosisRouteChannel(noble, 'channel-17' /* Noble's depositChannel, for contrast */) === 'channel-1' &&
    osmosisRouteChannel(noble) !== noble.depositChannel
)
check(
  'depositing directly from Osmosis needs no hop — it uses the deposit route channel',
  osmosisRouteChannel(osmosisChain, 'channel-750') === 'channel-750'
)
check(
  'an unrouted chain resolves to no channel at all, rather than a guess',
  osmosisRouteChannel(akash) === undefined
)

/* -------------------------------------------------------------------------- */

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exitCode = 1

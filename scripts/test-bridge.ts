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

import { quoteGasSlice, shouldOfferGas, buildGasLeg } from '../src/lib/getGas.ts'
import { gasCreditMemo, wrapDepositMemo, osmosisSwapToSecretMemo } from '../src/lib/ibcMemo.ts'
import { GAS_VAULT_ADDRESS, IBC_HOOKS_WRAPPER } from '../src/chains/secret4.ts'
import { CROSSCHAIN_SWAPS_CONTRACT, SCRT_ON_OSMOSIS } from '../src/chains/osmosis.ts'

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
check('native delivery sends SCRT to the user', nativeInner.wasm.msg.osmosis_swap.receiver === USER)
check('native delivery runs no hook on Secret', nativeInner.wasm.msg.osmosis_swap.next_memo === null)

const credits = buildGasLeg({ secretAddress: USER, osmosisAddress: OSMO, delivery: 'credits' })
const creditsInner = JSON.parse(credits.memo) as {
  wasm: { msg: { osmosis_swap: { receiver: string; next_memo: { wasm: { contract: string } } } } }
}
check(
  'credit delivery addresses the vault, not the user',
  creditsInner.wasm.msg.osmosis_swap.receiver === GAS_VAULT_ADDRESS
)
check(
  'credit delivery nests the hook in next_memo, the slot that reaches Secret',
  creditsInner.wasm.msg.osmosis_swap.next_memo.wasm.contract === GAS_VAULT_ADDRESS
)

/* -------------------------------------------------------------------------- */

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exitCode = 1

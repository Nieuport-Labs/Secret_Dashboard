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

import { quoteGasSlice, shouldOfferGas, fittingGasSliceUsd } from '../src/lib/getGas.ts'
import { wrapDepositMemo } from '../src/lib/ibcMemo.ts'
import { parseSkipTransferMsg, planSkipAddresses } from '../src/lib/skipGo.ts'
import { IBC_HOOKS_WRAPPER } from '../src/chains/secret4.ts'

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

// A comfortable balance no longer blocks the offer — only "urgent" (and so the
// checkbox's default) responds to it. Someone topping up before a bigger
// transaction can still reach for this; it just isn't reached for on their
// behalf.
const plenty = shouldOfferGas('5000000', quote, '100000000') // 5 SCRT held
check('still offered when the wallet already has plenty', plenty.offer === true)
check('but not urgent with a comfortable balance', plenty.offer === true && plenty.urgent === false)

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
/* Memo shapes — the main leg                                                  */
/* -------------------------------------------------------------------------- */

/*
 * Secret's ibc-hooks requires receiver == memo.wasm.contract. This asserts
 * that pairing, because setting them independently produces a packet that
 * arrives and quietly does nothing.
 */

const wrap = wrapDepositMemo('secret1token', 'deadbeef', USER)
const wrapParsed = JSON.parse(wrap.memo) as { wasm: { contract: string; msg: Record<string, unknown> } }
check('wrap memo is addressed to the hook contract', wrap.receiver === IBC_HOOKS_WRAPPER)
check('wrap receiver equals wasm.contract', wrap.receiver === wrapParsed.wasm.contract)
check('wrap carries the recipient inside the message', JSON.stringify(wrapParsed.wasm.msg).includes(USER))

/* -------------------------------------------------------------------------- */
/* Skip Go — routing the gas leg                                              */
/* -------------------------------------------------------------------------- */

/*
 * The gas leg used to be a hand-composed memo against Osmosis's own
 * `crosschain-swaps` contract. Two live packets in a row failed against it:
 * first "invalid receiver" (its receiver validation resolves a bare `secret1…`
 * through a governor-only map that was never given an entry for `secret`),
 * then — once that was fixed — "No route found" (its swap step routes through
 * an equally governor-only pool list that was never given an entry for
 * anything but `OSMO → SCRT`). Both limits live in contracts this app does not
 * own and cannot change. See docs/chain-facts.md for the full trace of both.
 *
 * Skip's routing API replaces the whole mechanism: it draws on Osmosis's live
 * poolmanager rather than a hand-maintained list, and returns a fully-formed
 * message rather than asking the caller to compose a wasm hook it never
 * documented. What is tested here is the parsing of that response — the
 * network call itself is not something a plain-Node assertion list can cover,
 * so a captured shape stands in for it.
 */

const skipMsgsResponse = {
  msgs: [
    {
      multi_chain_msg: {
        chain_id: 'noble-1',
        path: ['noble-1', 'osmosis-1', 'secret-4'],
        msg_type_url: '/ibc.applications.transfer.v1.MsgTransfer',
        msg: JSON.stringify({
          source_port: 'transfer',
          source_channel: 'channel-1',
          token: { denom: 'uusdc', amount: '130000' },
          sender: 'noble1lvwv5eg44lkj26ntsp6cnl82px7pa08y99vh8e',
          receiver: 'osmo10a3k4hvk37cc4hnxctw4p95fhscd2z6h2rmx0aukc6rm8u9qqx9smfsh7u',
          timeout_height: {},
          // A real payload carries this as a number this large enough to lose
          // precision in JS; irrelevant here since parseSkipTransferMsg never
          // reads it, so it is just the field's presence that matters.
          timeout_timestamp: 1788739871402052000,
          memo: '{"wasm":{"contract":"osmo10a3k4h…","msg":{"swap_and_action":{}}}}'
        })
      }
    }
  ]
}

const parsedLeg = parseSkipTransferMsg(skipMsgsResponse)
check('parses the channel out of the source-chain MsgTransfer', parsedLeg?.channel === 'channel-1', parsedLeg)
check('parses the token amount, not the swap output estimate', parsedLeg?.amount === '130000', parsedLeg)
check(
  "parses the receiver — Skip's own entry-point contract on Osmosis, not Secret",
  Boolean(parsedLeg?.receiver.startsWith('osmo1')),
  parsedLeg
)
check('carries the memo through untouched', typeof parsedLeg?.memo === 'string' && parsedLeg.memo.length > 0)

check(
  'a plan needing more than one signature is refused',
  parseSkipTransferMsg({ msgs: [{}, {}] }) === undefined
)
check('an empty plan is refused', parseSkipTransferMsg({ msgs: [] }) === undefined)
check(
  'a non-transfer message type is refused rather than misread',
  parseSkipTransferMsg({
    msgs: [{ multi_chain_msg: { msg_type_url: '/cosmwasm.wasm.v1.MsgExecuteContract', msg: '{}' } }]
  }) === undefined
)
check(
  'malformed JSON in the wrapped message is refused, not thrown',
  parseSkipTransferMsg({
    msgs: [
      { multi_chain_msg: { msg_type_url: '/ibc.applications.transfer.v1.MsgTransfer', msg: 'not json' } }
    ]
  }) === undefined
)
check('a response with no msgs field at all is refused', parseSkipTransferMsg({}) === undefined)

/*
 * Address planning: the two route shapes this app actually signs for. Any
 * other chain sequence — a route through some third chain neither Osmosis nor
 * Secret — is refused rather than guessed at, since deriving an address for a
 * chain nobody asked the wallet to enable is a new failure mode of its own.
 */

const addresses = { source: 'noble1sender', osmosis: 'osmo1relay', secret: 'secret1receiver' }

check(
  'source → Osmosis → Secret plans all three addresses in order',
  JSON.stringify(planSkipAddresses(['noble-1', 'osmosis-1', 'secret-4'], addresses)) ===
    JSON.stringify(['noble1sender', 'osmo1relay', 'secret1receiver'])
)
check(
  'depositing from Osmosis itself needs only two — source already is the Osmosis address',
  JSON.stringify(planSkipAddresses(['osmosis-1', 'secret-4'], addresses)) ===
    JSON.stringify(['noble1sender', 'secret1receiver'])
)
check(
  'refused without an Osmosis address when the route needs one',
  planSkipAddresses(['noble-1', 'osmosis-1', 'secret-4'], { ...addresses, osmosis: undefined }) === undefined
)
check(
  'refused for a route through any chain other than Osmosis',
  planSkipAddresses(['noble-1', 'stride-1', 'secret-4'], addresses) === undefined
)

/* -------------------------------------------------------------------------- */

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exitCode = 1

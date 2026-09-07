/**
 * Tests for the wallet's activity feed: turning chain movements into things a
 * person did.
 *
 * The fixtures are real transactions from secret-4, reduced to the fields the
 * summariser reads. The interesting ones are the transactions that move the
 * same coin twice — an unwrap and an IBC send in one signature — because those
 * are the ones a naive reading turns into two events for something the user did
 * once.
 *
 * Plain Node through --experimental-strip-types, matching test-bridge.ts.
 *
 *   npm run test:activity
 */

import { summarisePublicTransfers } from '../src/lib/activity.ts'
import type { PublicTransfer } from '../src/lib/publicHistory.ts'
import { SSCRT_ADDRESS } from '../src/tokens/registry.ts'
import { bankDenomFor, tokenAddressForBankDenom } from '../src/tokens/routes.ts'

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

/** USDC's voucher on Secret, and the SNIP-20 that wraps it. */
const USDC_DENOM = 'ibc/9162FF8AC138FFAB8723606E1FD726A95A2A153831ED6786396C374004AC28F8'
const USDC_CONTRACT = 'secret1chsejpk9kfj4vt9ec6xvyguw539gsdtr775us2'
/** The transfer module's escrow for the outgoing channel. */
const ESCROW = 'secret1yl6hdjhmkf3vc4x0mrhhqxkdkl2p7ghpes8v5m'
const SOMEONE = 'secret16dyfc744j0lp4x0vnwq3d9dr9v7z0lc0wgdxwx'

function transfer(over: Partial<PublicTransfer> = {}): PublicTransfer {
  return {
    hash: 'HASH',
    height: 100,
    at: 1_757_240_000,
    denom: USDC_DENOM,
    amount: '3870593',
    counterparty: SOMEONE,
    direction: 'in',
    ibc: false,
    ...over
  }
}

/* -------------------------------------------------------------------------- */
/* Denominations                                                              */
/* -------------------------------------------------------------------------- */

check('a voucher resolves to the SNIP-20 that wraps it', tokenAddressForBankDenom(USDC_DENOM) === USDC_CONTRACT)
check('uscrt resolves to sSCRT', tokenAddressForBankDenom('uscrt') === SSCRT_ADDRESS)
check('sSCRT spends uscrt', bankDenomFor(SSCRT_ADDRESS) === 'uscrt')

/*
 * Secret-native tokens leave over a contract of their own rather than the
 * transfer module, so their withdraw route names a `secret1…` address in the
 * denomination field. That is not a bank denomination, and a wrap that tried to
 * send it would spend a coin which cannot exist.
 */
check(
  'a contract address is not accepted as a bank denomination',
  bankDenomFor('secret153wu605vvp934xhd4k9dtd640zsep5jkesstdm') === undefined
)
check('and nothing maps back from one', tokenAddressForBankDenom('secret153wu605vvp934xhd4k9dtd640zsep5jkesstdm') === undefined)

/* -------------------------------------------------------------------------- */
/* One transaction, one event                                                 */
/* -------------------------------------------------------------------------- */

/*
 * Bridging a private token out unwraps and sends in a single transaction, so
 * the bank module sees the money arrive from the SNIP-20 contract and leave to
 * the escrow. Captured from 5853D3CA…, which is this app's own withdraw path.
 */
const withdrawLegs: PublicTransfer[] = [
  transfer({ direction: 'in', counterparty: USDC_CONTRACT, ibc: true }),
  transfer({ direction: 'out', counterparty: ESCROW, ibc: true })
]

const withdraw = summarisePublicTransfers(withdrawLegs)
check('unwrap-and-bridge is one event, not two', withdraw.length === 1, withdraw)
check('and that event is the bridge', withdraw[0]?.kind === 'bridged-out', withdraw[0])
check('named after the escrow, not the token contract', withdraw[0]?.counterparty === ESCROW, withdraw[0])
check('for the amount that actually left', withdraw[0]?.amount === '3870593', withdraw[0])

/* The mirror: a deposit that wraps on arrival. */
const depositLegs: PublicTransfer[] = [
  transfer({ direction: 'in', counterparty: ESCROW, ibc: true }),
  transfer({ direction: 'out', counterparty: USDC_CONTRACT, ibc: true })
]

const deposit = summarisePublicTransfers(depositLegs)
check('bridge-and-wrap is one event too', deposit.length === 1, deposit)
check('and it reads as an arrival', deposit[0]?.kind === 'bridged-in', deposit[0])

/* -------------------------------------------------------------------------- */
/* The plain cases                                                            */
/* -------------------------------------------------------------------------- */

const wrap = summarisePublicTransfers([transfer({ direction: 'out', counterparty: USDC_CONTRACT })])
check('funds into their own contract is a wrap', wrap[0]?.kind === 'wrapped', wrap[0])
check('with no counterparty worth naming', wrap[0]?.counterparty === undefined, wrap[0])

const unwrap = summarisePublicTransfers([transfer({ direction: 'in', counterparty: USDC_CONTRACT })])
check('and back out of it is an unwrap', unwrap[0]?.kind === 'unwrapped', unwrap[0])

const paid = summarisePublicTransfers([transfer({ direction: 'out', counterparty: SOMEONE })])
check('a payment is a payment', paid[0]?.kind === 'sent', paid[0])
check('and it names who was paid', paid[0]?.counterparty === SOMEONE, paid[0])

/*
 * Two payments to two people in one transaction really are two movements, and
 * folding them would hide one of them.
 */
const batch = summarisePublicTransfers([
  transfer({ direction: 'out', counterparty: SOMEONE, amount: '100' }),
  transfer({ direction: 'out', counterparty: ESCROW, amount: '200' })
])
check('separate payments in one transaction stay separate', batch.length === 2, batch)
check('with distinct ids', batch[0]?.id !== batch[1]?.id, batch.map((entry) => entry.id))

/* Different coins in one transaction are different events. */
const twoCoins = summarisePublicTransfers([
  transfer({ direction: 'in', denom: 'uscrt', amount: '1000000' }),
  transfer({ direction: 'in', denom: USDC_DENOM, amount: '5' })
])
check('two denominations are two events', twoCoins.length === 2, twoCoins)
check(
  'and each is named for its own asset',
  twoCoins.some((entry) => entry.symbol === 'SCRT') && twoCoins.some((entry) => entry.symbol === 'USDC'),
  twoCoins.map((entry) => entry.symbol)
)

/* -------------------------------------------------------------------------- */
/* Assets this app does not know                                              */
/* -------------------------------------------------------------------------- */

const unknown = summarisePublicTransfers([
  transfer({ denom: 'ibc/0000000000000000000000000000000000000000000000000000000000000000' })
])
check('an unclaimed voucher still appears', unknown.length === 1, unknown)
check('shown by a recognisable fragment of its denom', unknown[0]?.symbol.startsWith('IBC '), unknown[0])
check(
  'and with no decimal places invented for it',
  unknown[0]?.decimals === undefined,
  unknown[0]
)

/* -------------------------------------------------------------------------- */

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exitCode = 1

/**
 * Tests for the rules auto-refill and easy mode hang on: how much a refill
 * takes, and which tokens may be unwrapped.
 *
 *   npm run test:refill
 */

// zustand's persist reads `window.localStorage`; nothing here needs it to work.
Object.defineProperty(globalThis, 'window', { configurable: true, value: globalThis })

const { CREDIT_FLOOR, splitRefill } = await import('../src/lib/autoRefill.ts')
const { canUnwrap } = await import('../src/store/settings.ts')
const { SSCRT_ADDRESS } = await import('../src/tokens/registry.ts')
const { findRoutes, swapIn, swapOut } = await import('../src/lib/shadeSwap.ts')

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

const SCRT = 1_000_000n

{
  const split = (sscrt: bigint, scrt: bigint) => splitRefill(sscrt * SCRT, scrt * SCRT)
  const is = (got: ReturnType<typeof split>, sscrt: bigint, scrt: bigint, short: bigint) =>
    got.fromSscrt === sscrt && got.fromScrt === scrt && got.short === short

  check('plenty of sSCRT: 5 of it, nothing else', is(split(100n, 100n), 5n * SCRT, 0n, 0n))
  check('some sSCRT, the rest from SCRT', is(split(2n, 100n), 2n * SCRT, 3n * SCRT, 0n))
  check('no sSCRT: all 5 from SCRT', is(split(0n, 100n), 0n, 5n * SCRT, 0n))
  check(
    'SCRT is spent to the last unit, nothing held back',
    is(split(1n, 2n), 1n * SCRT, 2n * SCRT, 2n * SCRT)
  )
  check(
    'nothing at all: all 5 short, which is the swap or the notice',
    is(split(0n, 0n), 0n, 0n, CREDIT_FLOOR)
  )
  check(
    "except this transaction's own fee, when the wallet pays it",
    splitRefill(0n, 1n * SCRT, 50_000n).fromScrt === 1n * SCRT - 50_000n
  )
  check(
    'and a balance smaller than that fee spends nothing',
    splitRefill(0n, 10_000n, 50_000n).fromScrt === 0n
  )
}

const ATOM = 'secret19e75l25r6sa6nhdf4lggjmgpw0vmpfvsw5cnpe'
check('easy mode unwraps sSCRT', canUnwrap('easy', SSCRT_ADDRESS))
check('easy mode does not unwrap anything else', !canUnwrap('easy', ATOM))
check('unanswered counts as easy', !canUnwrap(undefined, ATOM))
check('expert mode unwraps anything', canUnwrap('expert', ATOM))

/* Pool arithmetic ---------------------------------------------------------- */

// A pool of 1,000,000 X against 2,000,000 Y with a 0.3% fee.
const X = 1_000_000_000_000n
const Y = 2_000_000_000_000n
const FEE_NUM = 3n
const FEE_DEN = 1000n

{
  const out = swapOut(X, Y, 1_000_000n, FEE_NUM, FEE_DEN)
  // 1 X at 2 Y each, less 0.3%, less a hair of price impact.
  check('a small trade gets the price less the fee', out > 1_993_000n && out <= 1_994_000n, out.toString())

  const back = swapIn(X, Y, out, FEE_NUM, FEE_DEN)!
  check('the inverse asks at least what was paid', back >= 1_000_000n, back.toString())
  check('and not much more', back - 1_000_000n < 10n, back.toString())
  check('what it asks for really buys the amount', swapOut(X, Y, back, FEE_NUM, FEE_DEN) >= out)
}

check('nothing in, nothing out', swapOut(X, Y, 0n, FEE_NUM, FEE_DEN) === 0n)
check('asking for the whole pool is refused', swapIn(X, Y, Y, FEE_NUM, FEE_DEN) === undefined)

{
  const ref = (address: string) => ({ address, codeHash: 'h' })
  const pair = (address: string, a: string, b: string) => ({
    contract: ref(address),
    token0: ref(a),
    token1: ref(b)
  })
  const pairs = [
    pair('p1', 'ATOM', 'SILK'),
    pair('p2', 'SILK', 'SSCRT'),
    pair('p3', 'ATOM', 'SSCRT'),
    pair('p4', 'USDC', 'SILK')
  ]

  const routes = findRoutes(pairs, 'ATOM', 'SSCRT')
  check(
    'a direct pair is a route',
    routes.some((route) => route.length === 1 && route[0].pair.contract.address === 'p3')
  )
  check(
    'and so is two hops through a shared token',
    routes.some(
      (route) => route.length === 2 && route[0].to.address === 'SILK' && route[1].to.address === 'SSCRT'
    )
  )
  check(
    'with every hop pointing the right way',
    routes.every((route) => route[0].from.address === 'ATOM')
  )
  check('a token with no way there has no route', findRoutes(pairs, 'OSMO', 'SSCRT').length === 0)
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)

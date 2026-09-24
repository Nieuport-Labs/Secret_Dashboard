/**
 * Tests for the rules auto-refill and easy mode hang on: how much a refill
 * takes, and which tokens may be unwrapped.
 *
 *   npm run test:refill
 */

// zustand's persist reads `window.localStorage`; nothing here needs it to work.
Object.defineProperty(globalThis, 'window', { configurable: true, value: globalThis })

const { CREDIT_FLOOR, refillAmount } = await import('../src/lib/autoRefill.ts')
const { canUnwrap } = await import('../src/store/settings.ts')
const { SSCRT_ADDRESS } = await import('../src/tokens/registry.ts')

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

check('5 credits or more: no refill', refillAmount(5n * SCRT, 100n * SCRT) === undefined)
check('below 5 with plenty of sSCRT: 5 sSCRT', refillAmount(4n * SCRT, 100n * SCRT) === CREDIT_FLOOR)
check('no credit at all: still 5, not more', refillAmount(0n, 100n * SCRT) === 5n * SCRT)
check('less than 5 sSCRT: all of it', refillAmount(1n * SCRT, 3n * SCRT) === 3n * SCRT)
check('no sSCRT: zero, which is the notice', refillAmount(1n * SCRT, 0n) === 0n)

const ATOM = 'secret19e75l25r6sa6nhdf4lggjmgpw0vmpfvsw5cnpe'
check('easy mode unwraps sSCRT', canUnwrap('easy', SSCRT_ADDRESS))
check('easy mode does not unwrap anything else', !canUnwrap('easy', ATOM))
check('unanswered counts as easy', !canUnwrap(undefined, ATOM))
check('expert mode unwraps anything', canUnwrap('expert', ATOM))

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)

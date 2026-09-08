/**
 * Tests for reading whatever was thrown.
 *
 * The fixtures are real error bodies from secret-4's LCD, captured verbatim.
 * They exist because the obvious reflex —
 * `e instanceof Error ? e.message : String(e)` — is wrong on this stack in the
 * most common case: secretjs's gRPC-gateway layer throws the node's parsed JSON
 * body, which is not an `Error`, so the reflex fell through to `String(e)` and
 * put "[object Object]" on screen.
 *
 * That was not only ugly. Four places in the app match a regex against the
 * message to decide what to *do* — whether a fee-grant query is unsupported,
 * whether a permit was rejected, whether a node returned HTML — and every one
 * of them was matching against "[object Object]" and taking the wrong branch.
 *
 * Plain Node through --experimental-strip-types, matching test-activity.ts.
 *
 *   npm run test:errors
 */

import { errorMessage, isNotFound } from '../src/lib/errors.ts'

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

/* -------------------------------------------------------------------------- */
/* Real bodies from secret-4                                                   */
/* -------------------------------------------------------------------------- */

/** GET /cosmos/gov/v1/proposals/99999 → HTTP 400. */
const MISSING_PROPOSAL = {
  code: 5,
  message: "rpc error: code = NotFound desc = proposal 99999 doesn't exist: key not found",
  details: []
}

/** GET /cosmos/gov/v1/proposals/372/votes/<an address that has not voted>. */
const NO_VOTE = {
  code: 3,
  message:
    'rpc error: code = InvalidArgument desc = voter: secret1kk… not found for proposal: 372: invalid request',
  details: []
}

/* -------------------------------------------------------------------------- */
/* errorMessage                                                                */
/* -------------------------------------------------------------------------- */

check(
  'gateway body yields its message, not [object Object]',
  errorMessage(MISSING_PROPOSAL) === "proposal 99999 doesn't exist: key not found",
  errorMessage(MISSING_PROPOSAL)
)

check(
  'the gRPC transport prefix is stripped',
  !errorMessage(MISSING_PROPOSAL).includes('rpc error: code ='),
  errorMessage(MISSING_PROPOSAL)
)

check('a real Error still yields its message', errorMessage(new Error('HTTP 502')) === 'HTTP 502')

check('a bare string passes through', errorMessage('went wrong') === 'went wrong')

check(
  'something with no message at all still yields a sentence',
  errorMessage({ nothing: true }).length > 0,
  errorMessage({ nothing: true })
)

check('null does not throw', errorMessage(null).length > 0, errorMessage(null))

check('undefined does not throw', errorMessage(undefined).length > 0, errorMessage(undefined))

/*
 * The regression that started all this: an object whose `message` is not a
 * string must not be treated as a gateway error and read out as one.
 */
check(
  'an object with a non-string message falls back rather than lying',
  errorMessage({ message: { nested: true } }) === '[object Object]',
  errorMessage({ message: { nested: true } })
)

/* -------------------------------------------------------------------------- */
/* isNotFound                                                                  */
/* -------------------------------------------------------------------------- */

check('gRPC status 5 is NotFound', isNotFound(MISSING_PROPOSAL))

check(
  'a missing vote is NotFound by its text, though its code is 3',
  isNotFound(NO_VOTE),
  NO_VOTE.message
)

check('a plain failure is not NotFound', !isNotFound(new Error('HTTP 502')))

check('a timeout is not NotFound', !isNotFound(new Error('The operation timed out.')))

/*
 * The distinction this exists to protect: mistaking a network blip for "no such
 * proposal" shows an empty state where a retry belongs.
 */
check('a JSON parse failure is not NotFound', !isNotFound(new SyntaxError("Unexpected token '<'")))

/* -------------------------------------------------------------------------- */
/* The branches that depend on the message                                     */
/* -------------------------------------------------------------------------- */

/** lib/feegrant.ts, deciding a granter query is unsupported by this node. */
const UNSUPPORTED = { code: 12, message: 'rpc error: code = Unimplemented desc = unknown method' }
check(
  'an unimplemented query is recognisable from a gateway body',
  /501|not implemented|unknown|unimplemented/i.test(errorMessage(UNSUPPORTED)),
  errorMessage(UNSUPPORTED)
)

/** lib/snip20.ts, deciding a balance read failed on the permit. */
const BAD_PERMIT = {
  code: 3,
  message: 'rpc error: code = Unknown desc = query contract failed: unauthorized: permit rejected'
}
check(
  'a rejected permit is recognisable from a gateway body',
  /unauthorized|permit|signature/i.test(errorMessage(BAD_PERMIT)),
  errorMessage(BAD_PERMIT)
)

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)

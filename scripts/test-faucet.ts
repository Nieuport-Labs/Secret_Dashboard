/**
 * Tests for the faucet proxy (`api/faucet.ts`) against a fake faucet: the
 * grant comes back trimmed to what the page needs, and anything short of a
 * grant is an error, not a grant of nothing.
 *
 *   npm run test:faucet
 */

import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

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

const USER = 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek'
const GRANTER = 'secret1chsejpk9kfj4vt9ec6xvyguw539gsdtr775us2'
let answer: { status: number; body: unknown } = { status: 200, body: {} }
let asked = ''

const server = createServer((request, response) => {
  asked = request.url ?? ''
  response.writeHead(answer.status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(answer.body))
})
await new Promise<void>((resolve) => server.listen(0, resolve))
process.env.FEE_FAUCET_URL = `http://localhost:${(server.address() as AddressInfo).port}/`

const { POST } = await import('../api/faucet.ts')
const call = (body: unknown) =>
  POST(new Request('https://x/api/faucet', { method: 'POST', body: JSON.stringify(body) }))

{
  answer = {
    status: 200,
    body: {
      address: USER,
      feegrant: {
        grantee: USER,
        granter: GRANTER,
        allowance: {
          '@type': '/cosmos.feegrant.v1beta1.BasicAllowance',
          spend_limit: [{ amount: '100000', denom: 'uscrt' }],
          expiration: '2026-09-26T10:00:00Z'
        }
      }
    }
  }
  const response = await call({ address: USER })
  const reply = (await response.json()) as { granter?: string; spendLimit?: string }
  check('it claims for the address given', asked === `/claim/${USER}`, asked)
  check(
    'and passes on who grants and how much',
    response.status === 200 && reply.granter === GRANTER && reply.spendLimit === '100000',
    reply
  )
}

{
  answer = { status: 400, body: { error: { code: 5 } } }
  check('a faucet that refuses is an error', (await call({ address: USER })).status === 502)
  answer = { status: 200, body: { address: USER } }
  check('and so is one that answers with no grant', (await call({ address: USER })).status === 502)
  check('a bad address is never sent on', (await call({ address: 'cosmos1abc' })).status === 400)
}

{
  delete process.env.FEE_FAUCET_URL
  const response = await call({ address: USER })
  const reply = (await response.json()) as { error?: string }
  check(
    'with no faucet set up it says so, rather than failing to reach one',
    response.status === 503 && /set up/.test(reply.error ?? ''),
    reply
  )
}

server.close()
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)

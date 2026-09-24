/**
 * Tests for the gRPC query proxy (`api/secret-query.ts`) against a fake gRPC
 * server on local HTTP/2: the request is framed and encoded as the chain
 * expects, the answer comes back, a chain error is a 502 and an unreachable
 * node a 503.
 *
 *   npm run test:grpc
 */

import { createServer } from 'node:http2'
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

const CONTRACT = 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek'
let seen: { path?: string; contentType?: string; contract?: string; query?: Buffer } = {}
let answerWith: 'ok' | 'contract-error' = 'ok'

/** Just enough protobuf to read the request back. */
function readFields(message: Buffer): Map<number, Buffer> {
  const fields = new Map<number, Buffer>()
  let offset = 0
  while (offset < message.length) {
    const tag = message[offset++]
    let length = 0
    let shift = 0
    for (;;) {
      const byte = message[offset++]
      length |= (byte & 0x7f) << shift
      if (byte < 0x80) break
      shift += 7
    }
    fields.set(tag >> 3, message.subarray(offset, offset + length))
    offset += length
  }
  return fields
}

const server = createServer((request, response) => {
  const chunks: Buffer[] = []
  request.on('data', (chunk: Buffer) => chunks.push(chunk))
  request.on('end', () => {
    const body = Buffer.concat(chunks)
    const fields = readFields(body.subarray(5, 5 + body.readUInt32BE(1)))
    seen = {
      path: request.headers[':path'] as string,
      contentType: request.headers['content-type'],
      contract: fields.get(1)?.toString('utf8'),
      query: fields.get(2)
    }
    response.writeHead(200, { 'content-type': 'application/grpc' })
    if (answerWith === 'contract-error') {
      response.addTrailers({
        'grpc-status': '2',
        'grpc-message': encodeURIComponent('query contract failed: encrypted: AAAA')
      })
      response.end()
      return
    }
    // QuerySecretContractResponse { data = 1 }: the query echoed back, reversed.
    const data = Buffer.from([...(seen.query ?? [])].reverse())
    const message = Buffer.concat([Buffer.from([0x0a, data.length]), data])
    const frame = Buffer.alloc(5 + message.length)
    frame.writeUInt32BE(message.length, 1)
    message.copy(frame, 5)
    response.addTrailers({ 'grpc-status': '0' })
    response.end(frame)
  })
})
const sessions = new Set<import('node:http2').ServerHttp2Session>()
server.on('session', (session) => sessions.add(session))
await new Promise<void>((resolve) => server.listen(0, resolve))
process.env.SECRET_GRPC_URL = `http://localhost:${(server.address() as AddressInfo).port}`

const { POST } = await import('../api/secret-query.ts')
const call = (body: unknown) =>
  POST(new Request('https://x/api/secret-query', { method: 'POST', body: JSON.stringify(body) }))

{
  const query = Buffer.from([1, 2, 3, 4, 5])
  const response = await call({ contract: CONTRACT, query: query.toString('base64') })
  const reply = (await response.json()) as { data?: string }
  check(
    'the call is QuerySecretContract over gRPC',
    seen.path === '/secret.compute.v1beta1.Query/QuerySecretContract' &&
      seen.contentType === 'application/grpc',
    seen
  )
  check(
    'carrying the contract and the encrypted query as sent',
    seen.contract === CONTRACT && seen.query?.equals(query) === true,
    seen
  )
  check(
    'and the answer comes back',
    response.status === 200 && reply.data === Buffer.from([5, 4, 3, 2, 1]).toString('base64'),
    reply
  )
}

{
  const big = Buffer.alloc(100_000, 7)
  const response = await call({ contract: CONTRACT, query: big.toString('base64') })
  check(
    'a query far too long for any URL goes through',
    response.status === 200 && seen.query?.length === 100_000,
    response.status
  )
}

{
  answerWith = 'contract-error'
  const response = await call({ contract: CONTRACT, query: 'AQID' })
  const reply = (await response.json()) as { error?: string }
  check(
    'a contract error is a 502 with its message',
    response.status === 502 && reply.error?.includes('encrypted: AAAA') === true,
    reply
  )
  answerWith = 'ok'
}

check(
  'a bad contract address is refused',
  (await call({ contract: 'cosmos1abc', query: 'AQID' })).status === 400
)
check('an empty query is refused', (await call({ contract: CONTRACT, query: '' })).status === 400)

// The proxy keeps its connection open between calls; cut it from this side.
await new Promise<void>((resolve) => {
  server.close(() => resolve())
  for (const session of sessions) session.destroy()
})

{
  // Nothing listens there any more: the path is down, not the chain.
  const response = await call({ contract: CONTRACT, query: 'AQID' })
  check('an unreachable node is a 503', response.status === 503, response.status)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)

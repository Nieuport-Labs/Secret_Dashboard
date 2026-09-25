/**
 * Tests for batched contract queries: answers come back by id through the
 * router, a batch the node refuses is split rather than lost, and without a
 * router every query is still answered on its own.
 *
 *   npm run test:batch
 */

import type { SecretNetworkClient } from 'secretjs'

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

const ROUTER = 'secret15mkmad8ac036v4nrpcc7nk8wyr578egt077syt'
const decode = (value: string) => JSON.parse(atob(value)) as { n?: number; fail?: boolean }
const encode = (value: unknown) => btoa(JSON.stringify(value))

interface Fake {
  /** The router refuses batches larger than this; `0` means there is no router at all. */
  routerLimit: number
  routerCalls: number[]
  singleCalls: number
}

function client(fake: Fake): SecretNetworkClient {
  const answer = (address: string, query: { n?: number }) => ({ address, doubled: (query.n ?? 0) * 2 })
  return {
    query: {
      compute: {
        codeHashByContractAddress: async () => ({ code_hash: 'hash' }),
        queryContract: async ({ contract_address, query }: { contract_address: string; query: Query }) => {
          if (contract_address === ROUTER) {
            const queries = query.batch.queries as Array<{
              id: string
              contract: { address: string }
              query: string
            }>
            fake.routerCalls.push(queries.length)
            if (queries.length > fake.routerLimit) throw new Error('{wasm contract} out of gas')
            return {
              batch: {
                block_height: 1,
                responses: queries.map((item) => {
                  const inner = decode(item.query)
                  return inner.fail
                    ? { id: item.id, contract: item.contract, response: { system_err: 'nope' } }
                    : {
                        id: item.id,
                        contract: item.contract,
                        response: { response: encode(answer(item.contract.address, inner)) }
                      }
                })
              }
            }
          }
          fake.singleCalls += 1
          if (query.fail) throw new Error('nope')
          return answer(contract_address, query)
        }
      }
    }
  } as unknown as SecretNetworkClient
}

type Query = {
  n?: number
  fail?: boolean
  batch: { queries: Array<{ id: string; contract: { address: string }; query: string }> }
}

const doubled = (result: unknown) => (result as { value?: { doubled?: number } } | undefined)?.value?.doubled

const items = (count: number) =>
  Array.from({ length: count }, (_, n) => ({
    id: `q${n}`,
    contract: { address: `secret1c${n}`, codeHash: 'h' },
    query: n === 3 ? { fail: true } : { n }
  }))

/*
 * The gRPC path (`lib/grpcQuery.ts`), faked end to end: the client's
 * "encryption" is a 32-byte nonce in front of the JSON, and `fetch` plays the
 * proxy, answering through the same fake router. These run first, while the
 * path is still up for the page.
 */
const utf8 = new TextEncoder()
const fromUtf8 = new TextDecoder()
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')

function grpcClient(fake: Fake): SecretNetworkClient {
  const base = client(fake) as unknown as Record<string, unknown>
  return {
    ...base,
    encryptionUtils: {
      encrypt: async (_hash: string, message: object) =>
        new Uint8Array([...new Uint8Array(32), ...utf8.encode(JSON.stringify(message))]),
      decrypt: async (ciphertext: Uint8Array) => ciphertext
    }
  } as unknown as SecretNetworkClient
}

interface Proxy {
  /** Answers 503 to this many requests before it works; `Infinity` never works. */
  failFirst: number
  calls: number
}

function proxy(fake: Fake, state: Proxy): void {
  const lcd = client(fake)
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    state.calls += 1
    if (state.calls <= state.failFirst) {
      return new Response(JSON.stringify({ error: 'connection reset' }), { status: 503 })
    }
    const { contract, query } = JSON.parse(init.body) as { contract: string; query: string }
    const message = JSON.parse(fromUtf8.decode(Buffer.from(query, 'base64').subarray(32))) as Query
    const reply = await lcd.query.compute.queryContract({
      contract_address: contract,
      code_hash: 'h',
      query: message
    })
    const data = b64(utf8.encode(b64(utf8.encode(JSON.stringify(reply)))))
    return new Response(JSON.stringify({ data }), { status: 200 })
  }) as unknown as typeof fetch
}

{
  const { batchQuery } = await import(`../src/lib/batchQuery.ts?grpc${1}`)
  const { grpcAvailable } = await import('@/lib/grpcQuery')
  const fake: Fake = { routerLimit: 100, routerCalls: [], singleCalls: 0 }
  const state: Proxy = { failFirst: 1, calls: 0 }
  proxy(fake, state)
  const results = await batchQuery(grpcClient(fake), items(10), { size: 10 })
  check('gRPC: one failed request is asked again the same way', state.calls === 2 && fake.singleCalls === 0, {
    state,
    fake
  })
  check('gRPC: and answered', doubled(results.get('q9')) === 18)
  check('gRPC: one hiccup does not switch the path off', grpcAvailable())
}

{
  const { batchQuery } = await import(`../src/lib/batchQuery.ts?grpc${2}`)
  const fake: Fake = { routerLimit: 100, routerCalls: [], singleCalls: 0 }
  proxy(fake, { failFirst: Infinity, calls: 0 })
  const results = await batchQuery(grpcClient(fake), items(5), { size: 10, lcdFallback: false })
  check(
    'gRPC: without LCD fallback, what it could not carry comes back failed, for the caller',
    fake.singleCalls === 0 && fake.routerCalls.length === 0 && results.get('q0')?.ok === false,
    fake
  )
}

{
  const { batchQuery } = await import(`../src/lib/batchQuery.ts?grpc${3}`)
  const { grpcAvailable } = await import('@/lib/grpcQuery')
  const fake: Fake = { routerLimit: 100, routerCalls: [], singleCalls: 0 }
  proxy(fake, { failFirst: Infinity, calls: 0 })
  const permit = 'x'.repeat(4_000)
  const big = Array.from({ length: 6 }, (_, n) => ({
    id: `g${n}`,
    contract: { address: `secret1g${n}`, codeHash: 'h' },
    query: { n, permit }
  }))
  const results = await batchQuery(grpcClient(fake), big, { size: 10 })
  check(
    'gRPC: falling back to the LCD, permit queries are not batched into a URL',
    fake.routerCalls.length === 0 && fake.singleCalls === 6,
    fake
  )
  check('gRPC: and answered', doubled(results.get('g5')) === 10)
  check('gRPC: repeated failures switch the path off', !grpcAvailable())
}

{
  const { batchQuery } = await import(`../src/lib/batchQuery.ts?${Date.now()}`)
  const fake: Fake = { routerLimit: 100, routerCalls: [], singleCalls: 0 }
  const results = await batchQuery(client(fake), items(30), { size: 20 })
  check(
    'thirty queries are a few requests, not thirty',
    fake.routerCalls.length <= 3 && fake.singleCalls === 0,
    fake
  )
  check('answers come back by id', doubled(results.get('q7')) === 14)
  check('a failed query fails alone', results.get('q3')?.ok === false && results.get('q4')?.ok === true)
}

{
  const { batchQuery } = await import(`../src/lib/batchQuery.ts?${Date.now() + 1}`)
  const fake: Fake = { routerLimit: 10, routerCalls: [], singleCalls: 0 }
  const results = await batchQuery(client(fake), items(40), { size: 40 })
  check(
    'a refused batch is split, not given up on',
    fake.routerCalls.some((n) => n > 10) && fake.routerCalls.some((n) => n > 1 && n <= 10),
    fake
  )
  check(
    'and every query is still answered',
    [...Array(40).keys()].every((n) => results.has(`q${n}`))
  )
}

{
  const { batchQuery } = await import(`../src/lib/batchQuery.ts?${Date.now() + 2}`)
  const fake: Fake = { routerLimit: 0, routerCalls: [], singleCalls: 0 }
  const results = await batchQuery(client(fake), items(12), { size: 6 })
  check('with no router, every query is sent on its own', fake.singleCalls >= 12, fake)
  check('and answered', doubled(results.get('q11')) === 22)
}

{
  const { batchQuery } = await import(`../src/lib/batchQuery.ts?${Date.now() + 3}`)
  const fake: Fake = { routerLimit: 100, routerCalls: [], singleCalls: 0 }
  // A permit names every token it covers: several kB on its own.
  const permit = 'x'.repeat(4_000)
  const big = Array.from({ length: 5 }, (_, n) => ({
    id: `p${n}`,
    contract: { address: `secret1p${n}`, codeHash: 'h' },
    query: { n, permit }
  }))
  const results = await batchQuery(client(fake), big)
  check(
    'a query too long to share a URL is never batched',
    fake.routerCalls.length === 0 && fake.singleCalls === 5,
    fake
  )
  check('and still answered', doubled(results.get('p4')) === 8)
}

{
  const { batchQuery } = await import(`../src/lib/batchQuery.ts?${Date.now() + 4}`)
  const fake: Fake = { routerLimit: 100, routerCalls: [], singleCalls: 0 }
  await batchQuery(client(fake), items(200))
  check(
    'small queries share requests, a URL-sized handful each',
    fake.routerCalls.length > 1 && fake.routerCalls.every((n) => n <= 40),
    fake.routerCalls
  )
}

/* Hedged reads --------------------------------------------------------------- */

{
  const { hedged } = await import('../src/lib/concurrency.ts')
  const after = <T>(ms: number, value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms))
  const good = (answer: string) => answer !== 'bad'
  let seconds = 0
  const second = (ms: number, value: string) => () => {
    seconds += 1
    return after(ms, value)
  }

  seconds = 0
  check(
    'a quick answer needs no second request',
    (await hedged(() => after(5, 'a'), second(5, 'b'), 50, good)) === 'a' && seconds === 0
  )

  seconds = 0
  check(
    'a slow one is overtaken by the hedge',
    (await hedged(() => after(300, 'a'), second(5, 'b'), 20, good)) === 'b' && seconds === 1
  )

  seconds = 0
  check(
    'a failed first answer hedges at once',
    (await hedged(() => after(5, 'bad'), second(5, 'b'), 1_000, good)) === 'b'
  )

  check(
    'when both fail, the first answer stands',
    (await hedged(() => after(5, 'bad'), second(5, 'bad'), 10, good)) === 'bad'
  )

  const thrown = await hedged(() => Promise.reject(new Error('down')), second(5, 'b'), 1_000, good).catch(
    () => 'rejected'
  )
  check('a first request that throws still gets its hedge', thrown === 'b')

  const both = await hedged(
    () => Promise.reject(new Error('down')),
    () => Promise.reject(new Error('also down')),
    10,
    good
  ).catch(() => 'rejected')
  check('and two that throw reject rather than hang', both === 'rejected')
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)

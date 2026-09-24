import type { SecretNetworkClient } from 'secretjs'

import { codeHashFor } from '@/lib/codeHash'

/**
 * Many contract queries in one request, through Shade's Batch Query Router.
 *
 * A Secret contract query is not a cheap read: the node runs it inside its
 * enclave, and a public LCD answers a limited number at once. Twenty balance
 * queries fired together mostly wait for each other. The router is a contract
 * that runs a list of queries against other contracts and returns every answer
 * in one reply, so twenty become one round trip.
 *
 * Shade's own client uses it the same way, for pair data and for private
 * SNIP-20 queries (shade.js `batchQuery$`). A query carrying a permit works
 * through it too: the token checks the permit's signature, not who asked.
 *
 * It is an optimisation only. If the router cannot be reached or refuses the
 * batch, every query is sent on its own instead, as before, so nothing depends
 * on it working.
 */

/** Mainnet, from shade.js `docs/contracts.md`. The code hash is read from the chain. */
const ROUTER = 'secret15mkmad8ac036v4nrpcc7nk8wyr578egt077syt'

/**
 * Queries per request, by default. Each one spends query gas inside the
 * router, and a node refuses a batch that runs past its limit; shade.js sends
 * 60 pairs at a time. A batch the node refuses is split in half and tried
 * again, so a size that is too large for some node costs a retry, not the
 * answers.
 */
const BATCH_SIZE = 40
/** Below this, a refused batch is not split further but sent query by query. */
const SMALLEST_SPLIT = 4

export interface BatchItem {
  id: string
  contract: { address: string; codeHash: string }
  query: object
}

export type BatchResult = { ok: true; value: unknown } | { ok: false; error: string }

interface RouterReply {
  batch?: {
    responses?: Array<{ id: string; response: { response?: string; system_err?: string } }>
  }
}

function encode(value: unknown): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(value))))
}

function decode(value: string): unknown {
  return JSON.parse(decodeURIComponent(escape(atob(value))))
}

async function one(client: SecretNetworkClient, item: BatchItem): Promise<BatchResult> {
  try {
    const value = await client.query.compute.queryContract({
      contract_address: item.contract.address,
      code_hash: item.contract.codeHash,
      query: item.query
    })
    return { ok: true, value }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function throughRouter(
  client: SecretNetworkClient,
  items: BatchItem[]
): Promise<Map<string, BatchResult>> {
  const reply = (await client.query.compute.queryContract({
    contract_address: ROUTER,
    code_hash: await codeHashFor(client, ROUTER),
    query: {
      batch: {
        queries: items.map((item) => ({
          id: encode(item.id),
          contract: { address: item.contract.address, code_hash: item.contract.codeHash },
          query: encode(item.query)
        }))
      }
    }
  })) as RouterReply

  const responses = reply?.batch?.responses
  if (!Array.isArray(responses)) throw new Error('The batch router did not answer with a batch.')

  const results = new Map<string, BatchResult>()
  for (const entry of responses) {
    const id = decode(entry.id) as string
    if (entry.response.system_err !== undefined) {
      results.set(id, { ok: false, error: entry.response.system_err })
    } else if (entry.response.response !== undefined) {
      results.set(id, { ok: true, value: decode(entry.response.response) })
    }
  }
  return results
}

/** Set once the router has failed outright this page load, so a missing router costs one attempt, not one per call. */
let routerDown = false

async function run(
  client: SecretNetworkClient,
  chunk: BatchItem[],
  results: Map<string, BatchResult>
): Promise<void> {
  if (!routerDown && chunk.length > 1) {
    try {
      const answered = await throughRouter(client, chunk)
      for (const item of chunk) {
        results.set(item.id, answered.get(item.id) ?? { ok: false, error: 'No answer in the batch.' })
      }
      return
    } catch {
      // Most likely the batch ran past the node's query gas limit: halve it.
      if (chunk.length >= SMALLEST_SPLIT * 2) {
        const half = Math.ceil(chunk.length / 2)
        await Promise.all([
          run(client, chunk.slice(0, half), results),
          run(client, chunk.slice(half), results)
        ])
        return
      }
      routerDown = true
    }
  }
  const single = await Promise.all(chunk.map((item) => one(client, item)))
  chunk.forEach((item, index) => results.set(item.id, single[index]))
}

/**
 * Every query's answer, by id. A query that failed says so on its own; one
 * failure never costs the others their answers.
 *
 * @param onChunk called as each request comes back, with how many queries are answered so far.
 */
export async function batchQuery(
  client: SecretNetworkClient,
  items: BatchItem[],
  { size = BATCH_SIZE, onChunk }: { size?: number; onChunk?: (done: number, total: number) => void } = {}
): Promise<Map<string, BatchResult>> {
  const results = new Map<string, BatchResult>()
  if (items.length === 0) return results

  const chunks: BatchItem[][] = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))

  let done = 0
  await Promise.all(
    chunks.map(async (chunk) => {
      await run(client, chunk, results)
      done += chunk.length
      onChunk?.(done, items.length)
    })
  )
  return results
}

import type { SecretNetworkClient } from 'secretjs'

import { codeHashFor } from '@/lib/codeHash'
import {
  ContractQueryError,
  grpcAnswered,
  grpcAvailable,
  grpcFailed,
  grpcQueryContract
} from '@/lib/grpcQuery'
import { mapWithLimit } from '@/lib/concurrency'

/**
 * Many contract queries in one request, through Shade's Batch Query Router.
 *
 * A Secret contract query is not a cheap read: the node runs it inside its
 * enclave, and a public LCD answers a limited number at once. Twenty balance
 * queries fired together mostly wait for each other. The router is a contract
 * that runs a list of queries against other contracts and returns every answer
 * in one reply, so twenty become one round trip.
 *
 * Shade's own client uses it the same way, for pair data (shade.js
 * `batchQuery$`).
 *
 * Through the LCD, only for small queries. secretjs sends a contract query as a GET with the
 * encrypted query in the URL, and the batch is one query: its URL holds every
 * query in it, base64'd twice over and encrypted. A permit names every token
 * it covers, which makes one permit query several kB on its own — twenty of
 * them made a URL public nodes refuse outright, with nothing but "Failed to
 * fetch" to show for it. So batches are sized by how long their URL will be,
 * not by count, and a query too big to share a URL goes on its own.
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
/**
 * Characters of encoded queries per batch. Encryption and a second base64
 * roughly double it on the way into the URL, which then stays well under the
 * 8 kB many servers stop at.
 */
const URL_BUDGET = 3_000
/** Queries sent on their own run a few at a time, as the rest of the app's reads do. */
const SINGLE_CONCURRENCY = 6

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
  items: BatchItem[],
  viaGrpc: boolean
): Promise<Map<string, BatchResult>> {
  const query = {
    batch: {
      queries: items.map((item) => ({
        id: encode(item.id),
        contract: { address: item.contract.address, code_hash: item.contract.codeHash },
        query: encode(item.query)
      }))
    }
  }
  const codeHash = await codeHashFor(client, ROUTER)
  const reply = (
    viaGrpc
      ? await grpcQueryContract(client, ROUTER, codeHash, query)
      : await client.query.compute.queryContract({ contract_address: ROUTER, code_hash: codeHash, query })
  ) as RouterReply

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

interface Via {
  grpc: boolean
  /** A gRPC chunk that failed once is asked once more before anything else. */
  retried: boolean
  /** Whether a chunk the gRPC path could not carry goes through the LCD here, or comes back failed. */
  lcdFallback: boolean
}

/** Set once the router has failed outright this page load, so a missing router costs one attempt, not one per call. */
let routerDown = false

async function run(
  client: SecretNetworkClient,
  chunk: BatchItem[],
  results: Map<string, BatchResult>,
  via: Via
): Promise<void> {
  if (!routerDown && chunk.length > 1) {
    try {
      const answered = await throughRouter(client, chunk, via.grpc)
      if (via.grpc) grpcAnswered()
      for (const item of chunk) {
        results.set(item.id, answered.get(item.id) ?? { ok: false, error: 'No answer in the batch.' })
      }
      return
    } catch (error) {
      if (via.grpc && !(error instanceof ContractQueryError)) {
        // The gRPC path itself failed, not the chain. One hiccup — a dropped
        // connection, a cold function — is asked again the same way; only
        // repeated failures switch the path off (`grpcFailed`).
        grpcFailed()
        if (!via.retried && grpcAvailable()) {
          await run(client, chunk, results, { ...via, retried: true })
          return
        }
        if (!via.lcdFallback) {
          // The caller reads these its own way (useBalances: hedged, across LCDs).
          const message = error instanceof Error ? error.message : String(error)
          for (const item of chunk) results.set(item.id, { ok: false, error: message })
          return
        }
        // Through the LCD instead, re-chunked for the URL: what fits in a
        // request body may not fit there.
        await Promise.all(
          chunksOf(chunk, chunk.length, true).map((part) =>
            run(client, part, results, { grpc: false, retried: false, lcdFallback: true })
          )
        )
        return
      }
      // Most likely the batch ran past the node's query gas limit: halve it.
      if (chunk.length >= SMALLEST_SPLIT * 2) {
        const half = Math.ceil(chunk.length / 2)
        await Promise.all([
          run(client, chunk.slice(0, half), results, via),
          run(client, chunk.slice(half), results, via)
        ])
        return
      }
      routerDown = true
    }
  }
  const single = await mapWithLimit(chunk, SINGLE_CONCURRENCY, (item) => one(client, item))
  chunk.forEach((item, index) => results.set(item.id, single[index]))
}

/**
 * Chunks no longer than `size` queries or — through the LCD, where the query
 * rides in the URL — `URL_BUDGET` characters; an oversized query stands alone.
 * Through gRPC the query is a request body, and only the count matters.
 */
function chunksOf(items: BatchItem[], size: number, inUrl: boolean): BatchItem[][] {
  const chunks: BatchItem[][] = []
  let current: BatchItem[] = []
  let length = 0
  for (const item of items) {
    const itemLength = encode(item.query).length + encode(item.id).length + 200
    if (current.length > 0 && (current.length >= size || (inUrl && length + itemLength > URL_BUDGET))) {
      chunks.push(current)
      current = []
      length = 0
    }
    current.push(item)
    length += itemLength
  }
  if (current.length > 0) chunks.push(current)
  return chunks
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
  {
    size = BATCH_SIZE,
    onChunk,
    lcdFallback = true
  }: {
    size?: number
    onChunk?: (done: number, total: number) => void
    /**
     * `false` returns what the gRPC path could not carry as failed, for the
     * caller to read its own way, instead of sending it through the LCD here.
     */
    lcdFallback?: boolean
  } = {}
): Promise<Map<string, BatchResult>> {
  const results = new Map<string, BatchResult>()
  if (items.length === 0) return results

  const viaGrpc = grpcAvailable()
  let done = 0
  // A few requests at a time, whatever they carry.
  await mapWithLimit(chunksOf(items, size, !viaGrpc), viaGrpc ? 8 : 3, async (chunk) => {
    await run(client, chunk, results, { grpc: viaGrpc, retried: false, lcdFallback })
    done += chunk.length
    onChunk?.(done, items.length)
  })
  return results
}

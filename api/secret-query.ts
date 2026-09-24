import { connect, type ClientHttp2Session } from 'node:http2'

/**
 * One Secret contract query, forwarded over gRPC.
 *
 *   POST /api/secret-query  body: { contract: "secret1…", query: "<base64>" }
 *                           → { data: "<base64>" } | { error }
 *
 * Why this exists: the browser reaches Secret through LCD REST, which carries
 * a contract query in the URL. A permit names every token it covers, so a few
 * permit queries batched together make a URL public nodes refuse — which is
 * what keeps a balance sweep at one request per token. gRPC carries the query
 * in a request body, with no such limit, but no public Secret gRPC endpoint
 * lets a browser call it (no gRPC-web, no CORS). A server can.
 *
 * What this server sees: nothing it could read. The browser encrypts the query
 * for the node's enclave before it leaves, exactly as secretjs does, and the
 * answer comes back encrypted for the browser's own key. This only moves
 * ciphertext — the contract address is the one thing in the clear, as it is
 * to any LCD.
 *
 * It forwards `QuerySecretContract` and `CodeHashByContractAddress` — the
 * second so a balance sweep can learn every token's code hash in one round
 * trip instead of one LCD request each — and nothing else, so it is not a
 * general gRPC proxy.
 */

const ENDPOINT = process.env.SECRET_GRPC_URL ?? 'https://grpc.secretnetwork.pathrocknetwork.org:443'
const QUERY_METHOD = '/secret.compute.v1beta1.Query/QuerySecretContract'
const CODE_HASH_METHOD = '/secret.compute.v1beta1.Query/CodeHashByContractAddress'

const ADDRESS = /^secret1[02-9ac-hj-np-z]{38,58}$/
/** Encrypted queries base64'd. A batch of permit queries is tens of kB; this is generous. */
const MAX_QUERY_CHARS = 400_000
/** Code hashes asked for in one call: a whole token registry, with room. */
const MAX_CODE_HASHES = 300
const TIMEOUT_MS = 15_000
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
  })
}

/* -------------------------------------------------------------------------- */
/* Protobuf, the two fields that matter                                        */
/* -------------------------------------------------------------------------- */

function varint(value: number): number[] {
  const bytes: number[] = []
  while (value > 0x7f) {
    bytes.push((value & 0x7f) | 0x80)
    value >>>= 7
  }
  bytes.push(value)
  return bytes
}

/** `QuerySecretContractRequest { string contract_address = 1; bytes query = 2; }` */
function encodeRequest(contract: string, query: Uint8Array): Buffer {
  const address = Buffer.from(contract, 'utf8')
  return Buffer.concat([
    Buffer.from([0x0a, ...varint(address.length)]),
    address,
    Buffer.from([0x12, ...varint(query.length)]),
    Buffer.from(query)
  ])
}

/** `QueryByContractAddressRequest { string contract_address = 1; }` */
function encodeAddress(contract: string): Buffer {
  const address = Buffer.from(contract, 'utf8')
  return Buffer.concat([Buffer.from([0x0a, ...varint(address.length)]), address])
}

/**
 * Field 1 of a response, the only one either answer has:
 * `QuerySecretContractResponse { bytes data = 1; }`,
 * `QueryCodeHashResponse { string code_hash = 1; }`.
 */
function decodeResponse(message: Buffer): Buffer {
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
    if (tag === 0x0a) return message.subarray(offset, offset + length)
    offset += length
  }
  return Buffer.alloc(0)
}

/* -------------------------------------------------------------------------- */
/* gRPC over HTTP/2                                                            */
/* -------------------------------------------------------------------------- */

/** The chain answered, with a gRPC error status — a contract error, not a broken connection. */
class GrpcStatusError extends Error {}

/**
 * Kept between calls on a warm function, so a sweep pays for one TLS
 * handshake. A warm function also serves several requests at once, all on
 * this one connection — so a connection is never destroyed while it may be
 * carrying someone else's request; one that failed is only let go of, and
 * closes once what it carries is done.
 */
let session: ClientHttp2Session | undefined

function sessionFor(): ClientHttp2Session {
  if (session && !session.closed && !session.destroyed) return session
  const fresh = connect(ENDPOINT)
  const forget = () => {
    if (session === fresh) session = undefined
  }
  fresh.on('error', (error: Error & { code?: string }) => {
    console.error('secret-query connection error:', error.code ?? '', error.message)
    forget()
  })
  // A node closes idle connections (GOAWAY); a new request must not go to one that is going away.
  fresh.on('goaway', forget)
  fresh.on('close', forget)
  fresh.unref()
  session = fresh
  return fresh
}

/** Stop handing out `failed` to new requests, without cutting the ones it carries. */
function letGo(failed: ClientHttp2Session): void {
  if (session === failed) session = undefined
  if (!failed.closed && !failed.destroyed) failed.close()
}

function unary(method: string, message: Buffer): Promise<Buffer> {
  const connection = sessionFor()
  return new Promise<Buffer>((resolve, reject) => {
    const frame = Buffer.alloc(5 + message.length)
    frame[0] = 0
    frame.writeUInt32BE(message.length, 1)
    message.copy(frame, 5)

    const request = connection.request({
      ':method': 'POST',
      ':path': method,
      'content-type': 'application/grpc',
      te: 'trailers'
    })

    const chunks: Buffer[] = []
    let grpcStatus: string | undefined
    let grpcMessage: string | undefined
    const read = (headers: Record<string, unknown>) => {
      if (headers['grpc-status'] !== undefined) grpcStatus = String(headers['grpc-status'])
      if (headers['grpc-message'] !== undefined) grpcMessage = String(headers['grpc-message'])
    }

    request.setTimeout(TIMEOUT_MS, () => {
      request.close()
      reject(new Error('the gRPC node did not answer in time'))
    })
    request.on('response', read)
    request.on('trailers', read)
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('error', reject)
    request.on('end', () => {
      if (grpcStatus !== '0') {
        const message = grpcMessage
          ? decodeURIComponent(grpcMessage)
          : `gRPC status ${grpcStatus ?? 'missing'}`
        reject(grpcStatus === undefined ? new Error(message) : new GrpcStatusError(message))
        return
      }
      const body = Buffer.concat(chunks)
      if (body.length < 5) {
        reject(new Error('empty gRPC response'))
        return
      }
      resolve(decodeResponse(body.subarray(5, 5 + body.readUInt32BE(1))))
    })
    request.end(frame)
  }).catch((error: unknown) => {
    if (!(error instanceof GrpcStatusError)) letGo(connection)
    throw error
  })
}

/** A request whose connection failed under it is tried once more, on a new one. */
async function unaryWithRetry(method: string, message: Buffer): Promise<Buffer> {
  try {
    return await unary(method, message)
  } catch (error) {
    if (error instanceof GrpcStatusError) throw error
    return unary(method, message)
  }
}

/**
 * Code hashes are public and change only with a migration, so a warm function
 * keeps what it has read. An hour bounds how long a migrated contract is
 * answered with its old hash — and a query sent with it fails loudly, it does
 * not read the wrong contract.
 */
const HASH_TTL_MS = 60 * 60_000
const hashes = new Map<string, { hash: string; at: number }>()

async function codeHash(contract: string): Promise<string> {
  const cached = hashes.get(contract)
  if (cached && Date.now() - cached.at < HASH_TTL_MS) return cached.hash
  const hash = (await unaryWithRetry(CODE_HASH_METHOD, encodeAddress(contract))).toString('utf8')
  if (hash) hashes.set(contract, { hash, at: Date.now() })
  return hash
}

/**
 *   POST { codeHashes: ["secret1…", …] } → { codeHashes: { "secret1…": "<hash>" | null } }
 *
 * Every hash in one browser round trip; the calls behind it run side by side
 * on one connection. A contract whose hash could not be read maps to null.
 */
async function codeHashes(addresses: unknown): Promise<Response> {
  if (
    !Array.isArray(addresses) ||
    addresses.length === 0 ||
    addresses.length > MAX_CODE_HASHES ||
    !addresses.every((address) => typeof address === 'string' && ADDRESS.test(address))
  ) {
    return json({ error: 'bad codeHashes' }, 400)
  }
  const started = Date.now()
  const answers = await Promise.allSettled((addresses as string[]).map(codeHash))
  const result: Record<string, string | null> = {}
  let missing = 0
  answers.forEach((answer, index) => {
    const ok = answer.status === 'fulfilled' && answer.value !== ''
    if (!ok) missing += 1
    result[(addresses as string[])[index]] = ok ? answer.value : null
  })
  console.log(`secret-query codeHashes n=${addresses.length} missing=${missing} ms=${Date.now() - started}`)
  // Every one failing is the path being down, not a list of odd contracts.
  if (missing === addresses.length) return json({ error: 'no code hash could be read' }, 503)
  return json({ codeHashes: result })
}

export async function POST(request: Request): Promise<Response> {
  let body: { contract?: unknown; query?: unknown; codeHashes?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return json({ error: 'not JSON' }, 400)
  }
  if (body.codeHashes !== undefined) return codeHashes(body.codeHashes)
  if (typeof body.contract !== 'string' || !ADDRESS.test(body.contract))
    return json({ error: 'bad contract' }, 400)
  if (typeof body.query !== 'string' || body.query.length === 0 || body.query.length > MAX_QUERY_CHARS) {
    return json({ error: 'bad query' }, 400)
  }

  const started = Date.now()
  try {
    const data = await unaryWithRetry(
      QUERY_METHOD,
      encodeRequest(body.contract, Buffer.from(body.query, 'base64'))
    )
    // How long the node took, for finding where a slow sweep spends its time.
    console.log(`secret-query query bytes=${body.query.length} ms=${Date.now() - started}`)
    return json({ data: data.toString('base64') })
  } catch (error) {
    // A contract error comes back as a gRPC status carrying the (encrypted)
    // reason; the browser decrypts it. 502 says the chain answered; 503 says
    // the node could not be reached at all, so the browser stops using this.
    const message = error instanceof Error ? error.message : 'gRPC call failed'
    if (!(error instanceof GrpcStatusError)) {
      // "The pending stream has been canceled" says nothing on its own; the connection's error does.
      const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : ''
      console.error('secret-query transport failure:', message, cause && `(caused by: ${cause})`)
    }
    return json({ error: message }, error instanceof GrpcStatusError ? 502 : 503)
  }
}

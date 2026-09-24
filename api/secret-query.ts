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
 * It forwards `QuerySecretContract` and nothing else, so it is not a general
 * gRPC proxy.
 */

const ENDPOINT = process.env.SECRET_GRPC_URL ?? 'https://grpc.secretnetwork.pathrocknetwork.org:443'
const METHOD = '/secret.compute.v1beta1.Query/QuerySecretContract'

const ADDRESS = /^secret1[02-9ac-hj-np-z]{38,58}$/
/** Encrypted queries base64'd. A batch of permit queries is tens of kB; this is generous. */
const MAX_QUERY_CHARS = 400_000
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

/** `QuerySecretContractResponse { bytes data = 1; }` */
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

/** Kept between calls on a warm function, so a sweep pays for one TLS handshake. */
let session: ClientHttp2Session | undefined

function sessionFor(): ClientHttp2Session {
  if (session && !session.closed && !session.destroyed) return session
  session = connect(ENDPOINT)
  session.on('error', () => {
    session = undefined
  })
  session.unref()
  return session
}

function unary(message: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const frame = Buffer.alloc(5 + message.length)
    frame[0] = 0
    frame.writeUInt32BE(message.length, 1)
    message.copy(frame, 5)

    const request = sessionFor().request({
      ':method': 'POST',
      ':path': METHOD,
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
  })
}

export async function POST(request: Request): Promise<Response> {
  let body: { contract?: unknown; query?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return json({ error: 'not JSON' }, 400)
  }
  if (typeof body.contract !== 'string' || !ADDRESS.test(body.contract))
    return json({ error: 'bad contract' }, 400)
  if (typeof body.query !== 'string' || body.query.length === 0 || body.query.length > MAX_QUERY_CHARS) {
    return json({ error: 'bad query' }, 400)
  }

  try {
    const data = await unary(encodeRequest(body.contract, Buffer.from(body.query, 'base64')))
    return json({ data: data.toString('base64') })
  } catch (error) {
    // A contract error comes back as a gRPC status carrying the (encrypted)
    // reason; the browser decrypts it. 502 says the chain answered; 503 says
    // the node could not be reached at all, so the browser stops using this.
    const message = error instanceof Error ? error.message : 'gRPC call failed'
    return json({ error: message }, error instanceof GrpcStatusError ? 502 : 503)
  }
}

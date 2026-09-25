import type { SecretNetworkClient } from 'secretjs'

/**
 * A Secret contract query sent through `api/secret-query.ts`, which forwards it
 * over gRPC — a request body instead of a URL, so a query of any size fits.
 *
 * The encryption is secretjs's own, done here in the browser with the query
 * client's keys, the same steps as `client.query.compute.queryContract`: the
 * server in between only ever holds ciphertext.
 *
 * Used where the LCD's URL limit bites — a batch of permit queries through the
 * batch router (`lib/batchQuery.ts`). If this path keeps failing, it is switched
 * off for the page and everything goes back to the LCD.
 */

const ENDPOINT = '/api/secret-query'

interface Encryption {
  encrypt(codeHash: string, message: object): Promise<Uint8Array>
  decrypt(ciphertext: Uint8Array, nonce: Uint8Array): Promise<Uint8Array>
}

/**
 * The client's own encryption — typed private by secretjs, but it is the one
 * `queryContract` uses, and reusing it keeps the node's key fetched once.
 */
function encryption(client: SecretNetworkClient): Encryption {
  return (client as unknown as { encryptionUtils: Encryption }).encryptionUtils
}

/**
 * Failures of the path itself in a row. A single one is a dropped connection
 * or a cold function and is simply retried; this many in a row means the proxy
 * or its node is really down, and the page stops using it.
 */
const FAILURES_TO_GIVE_UP = 3
let failures = 0

export function grpcAvailable(): boolean {
  return failures < FAILURES_TO_GIVE_UP
}

export function grpcFailed(): void {
  failures += 1
}

export function grpcAnswered(): void {
  if (failures < FAILURES_TO_GIVE_UP) failures = 0
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

const utf8 = new TextDecoder()

/** secretjs's reading of a decrypted answer: base64 of the JSON, as UTF-8 bytes. */
function readAnswer(decrypted: Uint8Array): unknown {
  if (decrypted.length === 0) return {}
  return JSON.parse(utf8.decode(fromBase64(utf8.decode(decrypted))))
}

/** A contract error names itself inside the node's message, encrypted for us. */
async function readError(client: SecretNetworkClient, message: string, nonce: Uint8Array): Promise<string> {
  const match =
    /encrypted: (.+?): (?:instantiate|execute|query|reply to|migrate) contract failed/.exec(message) ??
    /(?:instantiate|execute|query|reply to|migrate) contract failed: encrypted: ([\w+/=]+)/.exec(message)
  if (!match) return message
  try {
    return utf8.decode(await encryption(client).decrypt(fromBase64(match[1]), nonce))
  } catch {
    return message
  }
}

export class ContractQueryError extends Error {}

export async function grpcQueryContract(
  client: SecretNetworkClient,
  contract: string,
  codeHash: string,
  query: object
): Promise<unknown> {
  const encrypted = await encryption(client).encrypt(codeHash.replace('0x', '').toLowerCase(), query)
  const nonce = encrypted.slice(0, 32)

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contract, query: toBase64(encrypted) })
  })
  const reply = (await response.json().catch(() => ({}))) as { data?: string; error?: string }

  if (response.ok && typeof reply.data === 'string') {
    return readAnswer(await encryption(client).decrypt(fromBase64(reply.data), nonce))
  }
  // 502 is the chain answering with an error; anything else is the path itself failing.
  if (response.status === 502 && reply.error) {
    throw new ContractQueryError(await readError(client, reply.error, nonce))
  }
  throw new Error(reply.error ?? `secret-query answered ${response.status}`)
}

/**
 * Code hashes for many contracts in one request (the proxy asks the node for
 * them side by side). Only the ones it could read; `undefined` when the path
 * itself failed, so the caller asks the LCD as before.
 */
export async function grpcCodeHashes(addresses: string[]): Promise<Map<string, string> | undefined> {
  if (addresses.length === 0 || !grpcAvailable()) return undefined
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ codeHashes: addresses })
    })
    const reply = (await response.json().catch(() => ({}))) as {
      codeHashes?: Record<string, string | null>
    }
    if (!response.ok || !reply.codeHashes) throw new Error(`secret-query answered ${response.status}`)
    grpcAnswered()
    const hashes = new Map<string, string>()
    for (const address of addresses) {
      const hash = reply.codeHashes[address]
      if (typeof hash === 'string' && /^[0-9a-f]{64}$/i.test(hash)) hashes.set(address, hash)
    }
    return hashes
  } catch {
    grpcFailed()
    return undefined
  }
}

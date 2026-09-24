/**
 * Tests for the first-run answers store: the server takes only what the
 * account itself signed, only the answers it knows, and never lets an older
 * copy — or a signed profile replayed here — stand in for them.
 *
 * Same harness as `test-profile.ts`: Keplr-style ADR-036 signatures from a real
 * key, with Redis and the LCD replaced by an in-memory `fetch`.
 *
 *   npm run test:preferences
 */

import { Secp256k1Wallet, type StdSignDoc } from '@cosmjs/amino'
import { toBase64, toUtf8 } from '@cosmjs/encoding'

import { GET, POST } from '../api/preferences.ts'
import type { PreferencesRecordBody, SignedPreferencesRecord } from '../src/lib/preferencesRecord.ts'

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
/* A fake Redis and LCD                                                        */
/* -------------------------------------------------------------------------- */

const store = new Map<string, string>()
const knownAccounts = new Set<string>()

process.env.KV_REST_API_URL = 'https://redis.test'
process.env.KV_REST_API_TOKEN = 'token'

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input)
  if (url === 'https://redis.test') {
    const [command, key, value] = JSON.parse(String(init?.body)) as string[]
    if (command === 'GET') return Response.json({ result: store.get(key) ?? null })
    if (command === 'SET') {
      store.set(key, value)
      return Response.json({ result: 'OK' })
    }
    return Response.json({ error: `unexpected ${command}` }, { status: 400 })
  }
  const account = /\/cosmos\/auth\/v1beta1\/accounts\/(secret1\w+)$/.exec(url)
  if (account) return new Response('{}', { status: knownAccounts.has(account[1]) ? 200 : 404 })
  throw new Error(`unexpected fetch ${url}`)
}) as typeof fetch

/* -------------------------------------------------------------------------- */
/* Signing, as Keplr does it                                                   */
/* -------------------------------------------------------------------------- */

async function wallet(seed: number) {
  const key = new Uint8Array(32).fill(seed)
  const signer = await Secp256k1Wallet.fromKey(key, 'secret')
  const [{ address }] = await signer.getAccounts()
  return { signer, address }
}

async function sign(
  signer: Secp256k1Wallet,
  signerAddress: string,
  body: unknown
): Promise<SignedPreferencesRecord> {
  const data = JSON.stringify(body)
  const doc: StdSignDoc = {
    chain_id: '',
    account_number: '0',
    sequence: '0',
    fee: { gas: '0', amount: [] },
    msgs: [{ type: 'sign/MsgSignData', value: { signer: signerAddress, data: toBase64(toUtf8(data)) } }],
    memo: ''
  }
  const { signature } = await signer.signAmino(signerAddress, doc)
  return { data, signature: signature.signature, pubKey: signature.pub_key.value }
}

function post(record: unknown): Promise<Response> {
  return POST(new Request('https://x/api/preferences', { method: 'POST', body: JSON.stringify(record) }))
}

const alice = await wallet(1)
const mallory = await wallet(2)
knownAccounts.add(alice.address)
knownAccounts.add(mallory.address)

const now = Date.now()
function body(signedAt: number, extra: Partial<PreferencesRecordBody> = {}): PreferencesRecordBody {
  return {
    v: 1,
    kind: 'preferences',
    address: alice.address,
    signedAt,
    preferences: { gas: 'autorefill', assets: 'easy' },
    ...extra
  }
}

{
  const first = await sign(alice.signer, alice.address, body(now))
  const response = await post(first)
  check('a Keplr-style signature is accepted', response.status === 200, await response.clone().text())

  const read = (await (
    await GET(new Request(`https://x/api/preferences?address=${alice.address}`))
  ).json()) as {
    record: SignedPreferencesRecord
  }
  check(
    'and read back verbatim',
    read.record?.data === first.data && read.record.signature === first.signature
  )

  const tampered = { ...first, data: first.data.replace('"easy"', '"expert"') }
  check('edited data after signing is refused', (await post(tampered)).status === 401)
}

{
  const forged = await sign(
    mallory.signer,
    mallory.address,
    body(now + 1, { preferences: { gas: 'scrt', assets: 'expert' } })
  )
  check('another key cannot answer for me', (await post(forged)).status === 401)
}

{
  const older = await sign(
    alice.signer,
    alice.address,
    body(now - 1000, { preferences: { gas: 'scrt', assets: 'easy' } })
  )
  check('an older copy does not overwrite a newer one', (await post(older)).status === 409)
}

{
  const unknown = await sign(
    alice.signer,
    alice.address,
    body(now + 2, { preferences: { gas: 'free', assets: 'easy' } as never })
  )
  check('an answer that is not one of the options is refused', (await post(unknown)).status === 400)
}

{
  const profile = await sign(alice.signer, alice.address, {
    v: 1,
    address: alice.address,
    signedAt: now + 3,
    profile: { name: 'Alice', bio: '', avatar: '', links: [] }
  })
  check('a signed profile cannot be replayed as preferences', (await post(profile)).status === 400)
}

{
  const future = await sign(alice.signer, alice.address, body(now + 60 * 60_000))
  check('a timestamp far in the future is refused', (await post(future)).status === 400)
}

{
  const stranger = await wallet(3)
  const record = await sign(stranger.signer, stranger.address, body(now, { address: stranger.address }))
  check('an account the chain has never seen cannot store one', (await post(record)).status === 403)
}

{
  const newer = await sign(
    alice.signer,
    alice.address,
    body(now + 10, { preferences: { gas: 'scrt', assets: 'expert' } })
  )
  check('a newer answer replaces the old one', (await post(newer)).status === 200)
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)

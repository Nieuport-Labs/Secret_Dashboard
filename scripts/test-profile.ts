/**
 * Tests for off-chain profiles: the server's signature check, and which copy
 * the dashboard believes when the chain and the server disagree.
 *
 * Signatures are made the way Keplr's `signArbitrary` makes them — an amino
 * signature over the ADR-036 document — by a real secp256k1 key, so a verifier
 * that rebuilt the document even slightly differently fails here rather than
 * in front of a user. Redis and the LCD are replaced with an in-memory `fetch`.
 *
 *   npm run test:profile
 */

import { Secp256k1Wallet, type StdSignDoc } from '@cosmjs/amino'
import { toBase64, toUtf8 } from '@cosmjs/encoding'

import { GET, POST } from '../api/profile.ts'
import type { Profile } from '../src/lib/profile.ts'
import type {
  OffchainProfile,
  ProfileRecordBody,
  RecordProfile,
  SignedProfileRecord
} from '../src/lib/profileRecord.ts'
import { effectiveProfile, linkProblem, normaliseLinkValue } from '../src/lib/profileRecord.ts'

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
  body: ProfileRecordBody
): Promise<SignedProfileRecord> {
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
  return POST(new Request('https://x/api/profile', { method: 'POST', body: JSON.stringify(record) }))
}

const ALICE: RecordProfile = {
  name: 'Žluťoučký kůň úpěl ďábelské ódy!',
  bio: 'Hi',
  avatar: '',
  links: [{ kind: 'x', value: 'alice' }]
}

/* -------------------------------------------------------------------------- */
/* The server                                                                  */
/* -------------------------------------------------------------------------- */

const alice = await wallet(1)
const mallory = await wallet(2)
knownAccounts.add(alice.address)
knownAccounts.add(mallory.address)

const now = Date.now()
const first = await sign(alice.signer, alice.address, {
  v: 1,
  address: alice.address,
  signedAt: now,
  profile: ALICE
})

{
  const response = await post(first)
  check('a Keplr-style signature is accepted', response.status === 200, await response.clone().text())

  const read = (await (await GET(new Request(`https://x/api/profile?address=${alice.address}`))).json()) as {
    record: SignedProfileRecord
  }
  check(
    'and read back verbatim',
    read.record?.data === first.data && read.record.signature === first.signature
  )
}

{
  const tampered = { ...first, data: first.data.replace('"Hi"', '"Pwned"') }
  check('edited data after signing is refused', (await post(tampered)).status === 401)
}

{
  const forged = await sign(mallory.signer, mallory.address, {
    v: 1,
    address: alice.address,
    signedAt: now + 1,
    profile: { ...ALICE, name: 'mallory' }
  })
  check('another key cannot write my profile', (await post(forged)).status === 401)
}

{
  const older = await sign(alice.signer, alice.address, {
    v: 1,
    address: alice.address,
    signedAt: now - 1000,
    profile: { ...ALICE, name: 'old' }
  })
  check('an older copy does not overwrite a newer one', (await post(older)).status === 409)
}

{
  const future = await sign(alice.signer, alice.address, {
    v: 1,
    address: alice.address,
    signedAt: now + 60 * 60_000,
    profile: ALICE
  })
  check('a timestamp far in the future is refused', (await post(future)).status === 400)
}

{
  const big = await sign(alice.signer, alice.address, {
    v: 1,
    address: alice.address,
    signedAt: now + 2,
    profile: { ...ALICE, avatar: 'data:image/webp;base64,' + 'A'.repeat(12_288) }
  })
  check('an avatar the contract would refuse is refused here too', (await post(big)).status === 400)

  const tooLong = await sign(alice.signer, alice.address, {
    v: 1,
    address: alice.address,
    signedAt: now + 3,
    profile: { ...ALICE, name: ALICE.name + 'x' }
  })
  check('33 characters of name is one too many', (await post(tooLong)).status === 400)
}

{
  const stranger = await wallet(3)
  const record = await sign(stranger.signer, stranger.address, {
    v: 1,
    address: stranger.address,
    signedAt: now,
    profile: ALICE
  })
  check('an account the chain has never seen cannot store one', (await post(record)).status === 403)
}

{
  const tombstone = await sign(alice.signer, alice.address, {
    v: 1,
    address: alice.address,
    signedAt: now + 10,
    profile: null
  })
  check('a removal is stored like any newer copy', (await post(tombstone)).status === 200)
}

{
  const badHandle = await sign(alice.signer, alice.address, {
    v: 1,
    address: alice.address,
    signedAt: now + 20,
    profile: { ...ALICE, links: [{ kind: 'x', value: 'not a handle' }] }
  })
  check('a malformed handle is refused on save', (await post(badHandle)).status === 400)
}

/* -------------------------------------------------------------------------- */
/* Link formats                                                                */
/* -------------------------------------------------------------------------- */

{
  const normalised: Array<[string, string, string]> = [
    ['x', '@alice_1', 'alice_1'],
    ['x', 'https://twitter.com/alice?s=20', 'alice'],
    ['x', 'x.com/alice', 'alice'],
    ['telegram', 'https://t.me/alice_bob', 'alice_bob'],
    ['github', 'github.com/octo-cat/repo', 'octo-cat'],
    ['discord', '@Alice.B', 'alice.b'],
    ['discord', 'Alice#1234', 'Alice#1234'],
    ['website', '  example.com ', 'example.com']
  ]
  for (const [kind, raw, expected] of normalised) {
    const got = normaliseLinkValue(kind, raw)
    check(`${kind} "${raw}" normalises to "${expected}"`, got === expected, got)
  }

  const valid: Array<[string, string]> = [
    ['x', 'alice_1'],
    ['telegram', 'alice_bob'],
    ['github', 'octo-cat'],
    ['discord', 'alice.b'],
    ['discord', 'Alice#1234'],
    ['website', 'example.com'],
    ['website', 'https://sub.example.co.uk/path?q=1'],
    ['mastodon', 'anything goes for unknown kinds']
  ]
  for (const [kind, value] of valid) {
    check(`${kind} "${value}" is accepted`, linkProblem(kind, value) === undefined, linkProblem(kind, value))
  }

  const invalid: Array<[string, string]> = [
    ['x', 'sixteen_chars_xx'],
    ['x', 'has space'],
    ['x', 'https://facebook.com/alice'],
    ['telegram', 'abcd'],
    ['telegram', '1alice'],
    ['github', '-octo'],
    ['github', 'octo--cat'],
    ['discord', 'a..b'],
    ['discord', 'x'],
    ['website', 'javascript:alert(1)'],
    ['website', 'localhost'],
    ['website', 'exa mple.com']
  ]
  for (const [kind, value] of invalid) {
    check(`${kind} "${value}" is refused`, linkProblem(kind, value) !== undefined)
  }
}

/* -------------------------------------------------------------------------- */
/* Which copy wins                                                             */
/* -------------------------------------------------------------------------- */

function offchain(profile: RecordProfile | null, signedAt: number): OffchainProfile {
  return { body: { v: 1, address: alice.address, signedAt, profile }, record: first }
}

function onChain(profile: RecordProfile, updatedAtSeconds: number): Profile {
  return { ...profile, updatedAt: updatedAtSeconds }
}

{
  const result = effectiveProfile(undefined, offchain(ALICE, now))
  check(
    'nothing on chain: the server copy shows, pending',
    result.pending && result.profile?.name === ALICE.name
  )
}
{
  const result = effectiveProfile(onChain(ALICE, now / 1000 - 5), offchain(ALICE, now))
  check(
    'same content on both sides is not pending, whatever the clocks say',
    !result.pending && result.profile?.name === ALICE.name
  )
}
{
  const result = effectiveProfile(onChain({ ...ALICE, name: 'old' }, now / 1000 - 60), offchain(ALICE, now))
  check('a newer server copy wins and is pending', result.pending && result.profile?.name === ALICE.name)
}
{
  const result = effectiveProfile(onChain({ ...ALICE, name: 'newer' }, now / 1000 + 60), offchain(ALICE, now))
  check(
    'a newer chain write wins and nothing is pending',
    !result.pending && result.profile?.name === 'newer'
  )
}
{
  const result = effectiveProfile(onChain(ALICE, now / 1000 - 60), offchain(null, now))
  check(
    'a newer removal hides the chain profile and is pending',
    result.pending && result.profile === undefined
  )
}
{
  const result = effectiveProfile(undefined, offchain(null, now))
  check(
    'a removal the chain already reflects is not pending',
    !result.pending && result.profile === undefined
  )
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)

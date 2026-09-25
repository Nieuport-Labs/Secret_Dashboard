/**
 * Tests for synced settings: what the server accepts (settings signed by a
 * device key the wallet vouched for, and nothing else), and which copy wins
 * when an account connects.
 *
 * The wallet signs as Keplr's `signArbitrary` does — an amino signature over
 * the ADR-036 document — and the device key is real WebCrypto P-256, so the
 * browser half and the server half are the same code the app runs. Redis, the
 * LCD and the browser's storage are in memory.
 *
 *   npm run test:settings
 */

import { Secp256k1Wallet, type StdSignDoc } from '@cosmjs/amino'
import { toBase64, toUtf8 } from '@cosmjs/encoding'

import { GET, POST } from '../api/settings.ts'
import {
  DEVICE_KEY_LIFETIME_MS,
  type DeviceKeyBody,
  type SettingsBody,
  type SyncedSettings,
  type WalletSigned
} from '../src/lib/settingsRecord.ts'

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
/* A fake Redis, LCD and browser                                               */
/* -------------------------------------------------------------------------- */

const store = new Map<string, string>()
const knownAccounts = new Set<string>()
const local = new Map<string, string>()

process.env.KV_REST_API_URL = 'https://redis.test'
process.env.KV_REST_API_TOKEN = 'token'

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => local.get(key) ?? null,
    setItem: (key: string, value: string) => void local.set(key, value),
    removeItem: (key: string) => void local.delete(key),
    clear: () => local.clear(),
    key: () => null,
    get length() {
      return local.size
    }
  } as Storage
})

// zustand's persist reads `window.localStorage`.
Object.defineProperty(globalThis, 'window', { configurable: true, value: globalThis })

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
  // The app's own calls, routed straight to the handlers.
  if (url.startsWith('/api/settings')) {
    const request = new Request(`https://x${url}`, init)
    return request.method === 'POST' ? POST(request) : GET(request)
  }
  const account = /\/cosmos\/auth\/v1beta1\/accounts\/(secret1\w+)$/.exec(url)
  if (account) return new Response('{}', { status: knownAccounts.has(account[1]) ? 200 : 404 })
  throw new Error(`unexpected fetch ${url}`)
}) as typeof fetch

/* -------------------------------------------------------------------------- */
/* Signing                                                                     */
/* -------------------------------------------------------------------------- */

async function wallet(seed: number) {
  const key = new Uint8Array(32).fill(seed)
  const signer = await Secp256k1Wallet.fromKey(key, 'secret')
  const [{ address }] = await signer.getAccounts()
  return { signer, address }
}

async function walletSign(
  signer: Secp256k1Wallet,
  signerAddress: string,
  body: unknown
): Promise<WalletSigned> {
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

async function deviceKey() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify'
  ])
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  return { pair, publicKey: toBase64(raw) }
}

async function deviceSign(pair: CryptoKeyPair, body: unknown): Promise<{ data: string; signature: string }> {
  const data = JSON.stringify(body)
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    pair.privateKey,
    new Uint8Array(toUtf8(data))
  )
  return { data, signature: toBase64(new Uint8Array(signature)) }
}

function post(record: unknown): Promise<Response> {
  return POST(new Request('https://x/api/settings', { method: 'POST', body: JSON.stringify(record) }))
}

const SETTINGS: SyncedSettings = {
  theme: 'dark',
  currency: 'CZK',
  feeMode: 'auto',
  feeGranter: '',
  notificationsEnabled: true,
  autoWrapDeposits: false,
  gasSliceUsd: 1,
  gasMode: 'autorefill',
  assetMode: 'easy'
}

/* -------------------------------------------------------------------------- */
/* The server                                                                  */
/* -------------------------------------------------------------------------- */

const alice = await wallet(1)
const mallory = await wallet(2)
knownAccounts.add(alice.address)
knownAccounts.add(mallory.address)

const now = Date.now()
const device = await deviceKey()
const vouch = (address: string, extra: Partial<DeviceKeyBody> = {}): DeviceKeyBody => ({
  v: 1,
  kind: 'device-key',
  address,
  key: device.publicKey,
  issuedAt: now,
  expiresAt: now + DEVICE_KEY_LIFETIME_MS,
  ...extra
})
const settingsBody = (signedAt: number, settings: SyncedSettings = SETTINGS): SettingsBody => ({
  v: 1,
  kind: 'settings',
  address: alice.address,
  signedAt,
  settings
})

const delegation = await walletSign(alice.signer, alice.address, vouch(alice.address))

{
  const signed = await deviceSign(device.pair, settingsBody(now))
  const response = await post({ ...signed, delegation })
  check(
    'settings signed by a vouched-for device key are accepted',
    response.status === 200,
    await response.clone().text()
  )

  const read = (await (await GET(new Request(`https://x/api/settings?address=${alice.address}`))).json()) as {
    record: { data: string }
  }
  check('and read back verbatim', read.record?.data === signed.data)

  const tampered = { ...signed, data: signed.data.replace('"CZK"', '"EUR"'), delegation }
  check('edited data after signing is refused', (await post(tampered)).status === 401)
}

{
  const other = await deviceKey()
  const signed = await deviceSign(other.pair, settingsBody(now + 1))
  check(
    'a device key the wallet never vouched for is refused',
    (await post({ ...signed, delegation })).status === 401
  )
}

{
  const forged = await walletSign(mallory.signer, mallory.address, vouch(alice.address))
  const signed = await deviceSign(device.pair, settingsBody(now + 2))
  check(
    'another wallet cannot vouch for my device',
    (await post({ ...signed, delegation: forged })).status === 401
  )

  const own = await walletSign(mallory.signer, mallory.address, vouch(mallory.address))
  check(
    "a key vouched for by one account cannot write another's",
    (await post({ ...signed, delegation: own })).status === 401
  )
}

{
  const expired = await walletSign(
    alice.signer,
    alice.address,
    vouch(alice.address, { issuedAt: now - DEVICE_KEY_LIFETIME_MS - 10, expiresAt: now - 10 })
  )
  const signed = await deviceSign(device.pair, settingsBody(now + 3))
  check('an expired device key is refused', (await post({ ...signed, delegation: expired })).status === 401)

  const forever = await walletSign(alice.signer, alice.address, vouch(alice.address, { expiresAt: now * 2 }))
  check(
    'a device key cannot be vouched for indefinitely',
    (await post({ ...signed, delegation: forever })).status === 400
  )
}

{
  const older = await deviceSign(device.pair, settingsBody(now - 1000, { ...SETTINGS, theme: 'light' }))
  check('an older copy does not overwrite a newer one', (await post({ ...older, delegation })).status === 409)
}

{
  const unknown = await deviceSign(
    device.pair,
    settingsBody(now + 4, { ...SETTINGS, gasMode: 'free' } as never)
  )
  check(
    'a value that is not one of the options is refused',
    (await post({ ...unknown, delegation })).status === 400
  )

  const extra = await deviceSign(
    device.pair,
    settingsBody(now + 5, { ...SETTINGS, lcdOverride: 'https://evil' } as never)
  )
  check('endpoints are not something that syncs', (await post({ ...extra, delegation })).status === 400)
}

{
  // The wallet's own signature over a device key, replayed as the settings.
  check(
    'a signed device key cannot be replayed as settings',
    (await post({ data: delegation.data, signature: delegation.signature, delegation })).status === 400
  )
}

{
  const stranger = await wallet(3)
  const theirs = await walletSign(stranger.signer, stranger.address, vouch(stranger.address))
  const signed = await deviceSign(device.pair, { ...settingsBody(now), address: stranger.address })
  check(
    'an account the chain has never seen cannot store any',
    (await post({ ...signed, delegation: theirs })).status === 403
  )
}

/* -------------------------------------------------------------------------- */
/* Which copy wins                                                             */
/* -------------------------------------------------------------------------- */

const { useSettings } = await import('../src/store/settings.ts')
const { connectSettings, watchSettings, useSettingsSync } = await import('../src/store/settingsSync.ts')
const unwatch = watchSettings()

/** Pretend this browser holds a key for the account, as `authorizeDevice` would leave it. */
async function giveDeviceKey(address: string, pair: CryptoKeyPair, vouched: WalletSigned) {
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
  localStorage.setItem(
    `secret-dashboard:device-key:${address}`,
    JSON.stringify({ jwk, expiresAt: now + DEVICE_KEY_LIFETIME_MS, delegation: vouched })
  )
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

{
  // Alice has settings on the server (CZK, from above). A fresh browser takes them.
  await connectSettings(alice.address)
  const state = useSettings.getState()
  check(
    "a fresh device takes the account's settings",
    state.currency === 'CZK' && state.gasMode === 'autorefill'
  )
  check('and does not ask the questions again', !useSettingsSync.getState().needsAnswers)
}

{
  const bob = await wallet(4)
  knownAccounts.add(bob.address)
  await connectSettings(bob.address)
  check('an account with nothing stored is asked the questions', useSettingsSync.getState().needsAnswers)
  check(
    "and is not handed the previous account's settings to keep",
    useSettingsSync.getState().owner === alice.address
  )
}

{
  // Back to Alice, with a key on this device: a toggle goes up without a prompt.
  await connectSettings(alice.address)
  await giveDeviceKey(alice.address, device.pair, delegation)
  useSettings.getState().set('assetMode', 'expert')
  await wait(1000)
  const stored = JSON.parse(store.get(`settings:v1:${alice.address}`) ?? '{}') as { data: string }
  check(
    'a change is pushed, signed by the device key',
    stored.data?.includes('"expert"'),
    useSettingsSync.getState()
  )
  check('and reported as synced', useSettingsSync.getState().status === 'synced')
}

{
  // Another device changed it since; this one takes the newer copy.
  const later = await deviceSign(device.pair, settingsBody(Date.now(), { ...SETTINGS, theme: 'light' }))
  await post({ ...later, delegation })
  await connectSettings(undefined)
  await connectSettings(alice.address)
  check('a newer copy from another device wins', useSettings.getState().theme === 'light')
}

{
  // Offline edit while signed out, then back: this device's newer copy goes up.
  await connectSettings(undefined)
  await wait(5)
  useSettings.getState().set('currency', 'EUR')
  await connectSettings(alice.address)
  const stored = JSON.parse(store.get(`settings:v1:${alice.address}`) ?? '{}') as { data: string }
  check('a change made signed out is sent on the next connect', stored.data?.includes('"EUR"'))
}

unwatch()

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)

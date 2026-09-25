/**
 * The settings that follow an account from device to device, as they are
 * signed and as `api/settings.ts` stores them.
 *
 * Shared by the app and the serverless function, so it imports nothing — the
 * function bundles through Vercel's esbuild, where the `@/` alias does not
 * resolve (see `tsconfig.edge.json`).
 *
 * Two kinds of signed record meet here:
 *
 * - a **device key**, signed once by the wallet (ADR-036): "this P-256 public
 *   key may write my settings until `expiresAt`". The private half stays in
 *   the browser that made it.
 * - the **settings** themselves, signed by that device key. That is what lets
 *   a toggle sync without a wallet prompt, while the store still accepts
 *   nothing the account did not authorise — a synced fee granter or asset mode
 *   is worth someone else's while to set.
 *
 * Both carry `kind`, so neither — nor a signed profile — can be replayed as
 * another.
 */

export type Theme = 'dark' | 'light'

/** Who pays transaction fees. Mirrors the fee-grant SDK's `SelectionMode`. */
export type FeeMode =
  /** Spend the best usable grant whenever one covers the fee. */
  | 'auto'
  /** Always use the grant named in `feeGranter`. */
  | 'select'
  /** Never spend a grant, even when one is usable. */
  | 'off'

/**
 * Who keeps the account able to pay fees.
 *
 * `autorefill`: the dashboard keeps the account's gas credits at 5 or more, so
 * a transaction never stalls on fees. `scrt`: fees come out of the account's
 * own SCRT, and watching that balance (and any gas credits) is the user's job.
 */
export type GasMode = 'autorefill' | 'scrt'

/**
 * How much of the asset machinery is on screen.
 *
 * `easy`: SCRT and private tokens, nothing more. `expert`: also unwrapping
 * non-SCRT assets back to their public state. Bridging works the same in both.
 */
export type AssetMode = 'easy' | 'expert'

/**
 * Everything that syncs. Endpoint overrides are left out on purpose: a node
 * that answers from one network may not from another, and a synced bad one
 * would break every device, including the one needed to put it right.
 */
export interface SyncedSettings {
  theme: Theme
  currency: string
  feeMode: FeeMode
  feeGranter: string
  notificationsEnabled: boolean
  autoWrapDeposits: boolean
  gasSliceUsd: number
  gasMode: GasMode
  assetMode: AssetMode
}

export const SYNCED_KEYS = [
  'theme',
  'currency',
  'feeMode',
  'feeGranter',
  'notificationsEnabled',
  'autoWrapDeposits',
  'gasSliceUsd',
  'gasMode',
  'assetMode'
] as const satisfies ReadonlyArray<keyof SyncedSettings>

export interface DeviceKeyBody {
  v: 1
  kind: 'device-key'
  address: string
  /** Base64 of the raw (uncompressed, 65-byte) P-256 public key. */
  key: string
  issuedAt: number
  expiresAt: number
}

export interface SettingsBody {
  v: 1
  kind: 'settings'
  address: string
  /** Wall-clock milliseconds when it was signed. Orders records, nothing more. */
  signedAt: number
  settings: SyncedSettings
}

/** A wallet's ADR-036 signature over `data`. Same shape as a signed profile. */
export interface WalletSigned {
  data: string
  signature: string
  pubKey: string
}

/** What travels and what is stored: settings signed by a key the wallet vouched for. */
export interface SignedSettingsRecord {
  data: string
  /** Base64 P-256 ECDSA signature over SHA-256 of `data`, raw r‖s (64 bytes). */
  signature: string
  delegation: WalletSigned
}

/** How long a device may write before the wallet has to vouch for it again. */
export const DEVICE_KEY_LIFETIME_MS = 180 * 24 * 60 * 60_000

const THEMES: readonly string[] = ['dark', 'light']
const FEE_MODES: readonly string[] = ['auto', 'select', 'off']
const GAS_MODES: readonly string[] = ['autorefill', 'scrt']
const ASSET_MODES: readonly string[] = ['easy', 'expert']

function parse<T>(data: string): T | string {
  try {
    return JSON.parse(data) as T
  } catch {
    return 'not JSON'
  }
}

/** The settings' own rules. Returns the reason they are unusable, if any. */
export function settingsProblem(settings: unknown): string | undefined {
  if (!settings || typeof settings !== 'object') return 'bad settings'
  const value = settings as Record<string, unknown>

  const extra = Object.keys(value).find((key) => !(SYNCED_KEYS as readonly string[]).includes(key))
  if (extra) return `unknown setting ${extra}`

  if (!THEMES.includes(value.theme as string)) return 'unknown theme'
  if (typeof value.currency !== 'string' || !/^[A-Z]{3}$/.test(value.currency)) return 'bad currency'
  if (!FEE_MODES.includes(value.feeMode as string)) return 'unknown fee mode'
  if (
    typeof value.feeGranter !== 'string' ||
    (value.feeGranter !== '' && !/^secret1[0-9a-z]{38,58}$/.test(value.feeGranter))
  ) {
    return 'bad fee granter'
  }
  if (typeof value.notificationsEnabled !== 'boolean') return 'bad notifications flag'
  if (typeof value.autoWrapDeposits !== 'boolean') return 'bad auto-wrap flag'
  if (typeof value.gasSliceUsd !== 'number' || !(value.gasSliceUsd >= 0 && value.gasSliceUsd <= 1000)) {
    return 'bad gas slice'
  }
  if (!GAS_MODES.includes(value.gasMode as string)) return 'unknown gas mode'
  if (!ASSET_MODES.includes(value.assetMode as string)) return 'unknown asset mode'
  return undefined
}

export function parseSettingsBody(data: string): SettingsBody | string {
  const body = parse<SettingsBody>(data)
  if (typeof body === 'string') return body
  if (!body || body.v !== 1) return 'unknown record version'
  if (body.kind !== 'settings') return 'not a settings record'
  if (typeof body.address !== 'string' || !body.address.startsWith('secret1')) return 'bad address'
  if (typeof body.signedAt !== 'number' || !Number.isFinite(body.signedAt)) return 'bad timestamp'
  return settingsProblem(body.settings) ?? body
}

export function parseDeviceKeyBody(data: string): DeviceKeyBody | string {
  const body = parse<DeviceKeyBody>(data)
  if (typeof body === 'string') return body
  if (!body || body.v !== 1) return 'unknown record version'
  if (body.kind !== 'device-key') return 'not a device key'
  if (typeof body.address !== 'string' || !body.address.startsWith('secret1')) return 'bad address'
  if (typeof body.key !== 'string' || body.key.length === 0) return 'bad key'
  if (typeof body.issuedAt !== 'number' || typeof body.expiresAt !== 'number') return 'bad timestamps'
  if (body.expiresAt - body.issuedAt > DEVICE_KEY_LIFETIME_MS) return 'device key lives too long'
  return body
}

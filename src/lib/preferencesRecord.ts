/**
 * The answers to the first-run questions, as a wallet signs them and
 * `api/preferences.ts` stores them.
 *
 * Shared by the app and the serverless function, so it imports nothing — the
 * function bundles through Vercel's esbuild, where the `@/` alias does not
 * resolve (see `tsconfig.edge.json`).
 *
 * Signed for the same reason a profile is: the store is keyed by address, and
 * without a signature anyone could answer for anyone — flip a stranger into
 * export mode, or off the gas refill they chose.
 */

/**
 * Who keeps the account able to pay fees.
 *
 * `autorefill`: the dashboard tops up gas credits so a transaction never stalls
 * on fees. `scrt`: fees come out of the account's own SCRT, and watching that
 * balance (and any gas credits) is the user's job.
 */
export type GasMode = 'autorefill' | 'scrt'

/**
 * How much of the asset machinery is on screen.
 *
 * `easy`: SCRT and private tokens, nothing more. `export`: also unwrapping
 * non-SCRT assets back to their public form, which is what taking them off
 * Secret Network needs.
 */
export type AssetMode = 'easy' | 'export'

export interface Preferences {
  gas: GasMode
  assets: AssetMode
}

export interface PreferencesRecordBody {
  v: 1
  /**
   * Names what was signed. A signed profile and a signed set of preferences
   * are otherwise both "a JSON object with an address in it", and neither may
   * be replayed as the other.
   */
  kind: 'preferences'
  address: string
  /** Wall-clock milliseconds when it was signed. Orders records, nothing more. */
  signedAt: number
  preferences: Preferences
}

/** Same shape as `SignedProfileRecord`: the signed string, verbatim. */
export interface SignedPreferencesRecord {
  data: string
  /** Base64 secp256k1 signature, 64 bytes. */
  signature: string
  /** Base64 compressed secp256k1 public key. */
  pubKey: string
}

const GAS_MODES: readonly GasMode[] = ['autorefill', 'scrt']
const ASSET_MODES: readonly AssetMode[] = ['easy', 'export']

/** Parse and check a body. Returns the reason it is unusable, or the body. */
export function parsePreferencesBody(data: string): PreferencesRecordBody | string {
  let body: PreferencesRecordBody
  try {
    body = JSON.parse(data) as PreferencesRecordBody
  } catch {
    return 'not JSON'
  }
  if (!body || body.v !== 1) return 'unknown record version'
  if (body.kind !== 'preferences') return 'not a preferences record'
  if (typeof body.address !== 'string' || !body.address.startsWith('secret1')) return 'bad address'
  if (typeof body.signedAt !== 'number' || !Number.isFinite(body.signedAt)) return 'bad timestamp'

  const preferences = body.preferences as Partial<Preferences> | undefined
  if (!preferences || typeof preferences !== 'object') return 'bad preferences'
  if (!GAS_MODES.includes(preferences.gas as GasMode)) return 'unknown gas mode'
  if (!ASSET_MODES.includes(preferences.assets as AssetMode)) return 'unknown asset mode'
  return body
}

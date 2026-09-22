/**
 * The off-chain profile record: what a wallet signs, what `api/profile.ts`
 * stores, and what the dashboard reads back when the chain has nothing newer.
 *
 * Shared by the app and the serverless function, so it imports nothing — the
 * function bundles through Vercel's esbuild, where the `@/` alias does not
 * resolve (see `tsconfig.edge.json`).
 *
 * Why it exists at all: saving a profile on chain costs gas, and an account
 * that has none would otherwise have no profile. The signature is free, the
 * server keeps it, and the next transaction the account sends carries the
 * on-chain write along with it (`lib/sendTx.ts`). The chain stays the source of
 * truth; this is the copy that fills the gap until it catches up.
 */

export interface RecordLink {
  kind: string
  value: string
}

export interface RecordProfile {
  name: string
  bio: string
  avatar: string
  links: RecordLink[]
}

export interface ProfileRecordBody {
  v: 1
  address: string
  /** Wall-clock milliseconds when it was signed. Orders records, nothing more. */
  signedAt: number
  /** `null` is a cleared profile — a tombstone, so a removal is not undone by an older copy. */
  profile: RecordProfile | null
}

/**
 * What travels and what is stored. `data` is the exact string the wallet
 * signed; it is kept verbatim rather than re-serialised, because the signature
 * covers bytes, not meaning, and anyone should be able to check it again.
 */
export interface SignedProfileRecord {
  data: string
  /** Base64 secp256k1 signature, 64 bytes. */
  signature: string
  /** Base64 compressed secp256k1 public key. */
  pubKey: string
}

/** A stored record, with its body already parsed and checked. */
export interface OffchainProfile {
  body: ProfileRecordBody
  record: SignedProfileRecord
}

/** Mirrors `contracts/profile/src/contract.rs`. The server enforces these too. */
export const RECORD_LIMITS = {
  name: 32,
  bio: 280,
  links: 8,
  linkKind: 16,
  linkValue: 200,
  /** Bytes of the whole `data:` URI, as the contract measures it. */
  avatar: 12_288
} as const

const AVATAR_PREFIX = 'data:image/webp;base64,'

/** Characters, not UTF-16 units, matching Rust's `chars().count()`. */
function chars(value: string): number {
  return [...value].length
}

/**
 * The contract's rules, applied before anything is signed or stored.
 *
 * This matters more than it looks: a record the contract would reject gets
 * attached to someone's next transaction, and a transaction fails whole. A
 * profile that cannot be written must never reach the point of taking a send
 * down with it.
 */
export function profileProblem(profile: RecordProfile): string | undefined {
  if (typeof profile.name !== 'string' || chars(profile.name) > RECORD_LIMITS.name) return 'name is too long'
  if (typeof profile.bio !== 'string' || chars(profile.bio) > RECORD_LIMITS.bio) return 'bio is too long'
  if (typeof profile.avatar !== 'string') return 'avatar is not text'
  if (profile.avatar !== '') {
    if (!profile.avatar.startsWith(AVATAR_PREFIX)) return 'avatar must be a WebP data URI'
    if (new TextEncoder().encode(profile.avatar).length > RECORD_LIMITS.avatar) return 'avatar is too large'
  }
  if (!Array.isArray(profile.links) || profile.links.length > RECORD_LIMITS.links) return 'too many links'
  for (const link of profile.links) {
    if (typeof link?.kind !== 'string' || typeof link?.value !== 'string') return 'malformed link'
    if (chars(link.kind) > RECORD_LIMITS.linkKind) return 'link kind is too long'
    if (chars(link.value) > RECORD_LIMITS.linkValue) return 'link value is too long'
  }
  return undefined
}

/** Parse and check a body. Returns the reason it is unusable, or the body. */
export function parseRecordBody(data: string): ProfileRecordBody | string {
  let body: ProfileRecordBody
  try {
    body = JSON.parse(data) as ProfileRecordBody
  } catch {
    return 'not JSON'
  }
  if (!body || body.v !== 1) return 'unknown record version'
  if (typeof body.address !== 'string' || !body.address.startsWith('secret1')) return 'bad address'
  if (typeof body.signedAt !== 'number' || !Number.isFinite(body.signedAt)) return 'bad timestamp'
  if (body.profile !== null) {
    if (typeof body.profile !== 'object') return 'bad profile'
    const problem = profileProblem(body.profile)
    if (problem) return problem
  }
  return body
}

/**
 * Canonical content, for "is the chain already saying this?". Field order is
 * fixed here so two equal profiles always compare equal as strings.
 */
export function profileKey(profile: RecordProfile | null | undefined): string {
  if (!profile) return 'null'
  return JSON.stringify({
    name: profile.name,
    bio: profile.bio,
    avatar: profile.avatar,
    links: profile.links.map((link) => ({ kind: link.kind, value: link.value }))
  })
}

/**
 * Which copy to show, given what the chain says and what the server holds.
 *
 * The same content on both sides means the chain has caught up and is the
 * answer. Otherwise the more recent one wins: the chain's `updatedAt` is block
 * time in seconds, the record's `signedAt` is the signer's clock in
 * milliseconds. Clocks can disagree by a little; comparing content first is
 * what keeps that from mattering in the common case, where a record was just
 * written on chain and its block is a few seconds "older" than a fast clock.
 */
export function effectiveProfile(
  chain: (RecordProfile & { updatedAt: number }) | undefined,
  offchain: OffchainProfile | undefined
): { profile: RecordProfile | undefined; pending: boolean } {
  const chainProfile: RecordProfile | undefined = chain
    ? { name: chain.name, bio: chain.bio, avatar: chain.avatar, links: chain.links }
    : undefined

  if (!offchain) return { profile: chainProfile, pending: false }
  if (profileKey(offchain.body.profile) === profileKey(chainProfile)) {
    return { profile: chainProfile, pending: false }
  }

  const chainMs = (chain?.updatedAt ?? 0) * 1000
  if (chain && chainMs > offchain.body.signedAt) return { profile: chainProfile, pending: false }

  return { profile: offchain.body.profile ?? undefined, pending: true }
}

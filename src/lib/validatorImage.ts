/**
 * Validator profiles, from Keybase.
 *
 * A validator's on-chain `description.identity` is a Keybase PGP key-fingerprint
 * suffix, not a picture or a set of social links — the chain never carries
 * either. Keplr and the block explorers all resolve it against Keybase's
 * public lookup API the same way; there is no Secret-specific mechanism to
 * reproduce here. Keybase's "proofs" are cryptographically signed claims the
 * validator operator posted on Twitter/GitHub/their own site linking it back
 * to this identity — which is the same reason those icons are trustworthy on
 * Keplr's validator page and not just a claimed link. Verified live: every
 * bonded validator's identity on secret-4 resolves against
 * `keybase.io/_/api/1.0/user/lookup.json`, and the endpoint sends
 * `Access-Control-Allow-Origin: *`, so this runs as a plain browser fetch with
 * no proxy.
 */

const KEYBASE_LOOKUP = 'https://keybase.io/_/api/1.0/user/lookup.json'
const TIMEOUT_MS = 8_000

/** How long a resolved (or empty) answer is trusted before asking again. */
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000
const CACHE_KEY = 'secret-dashboard:validator-images'

/**
 * One proof Keybase verified for this identity — a signed claim, not a
 * self-reported handle. `type` is Keybase's own vocabulary (`twitter`,
 * `github`, `reddit`, `hackernews`, `dns`/`generic_web_site` for a claimed
 * domain); anything else is passed through as-is rather than dropped, since a
 * link that cannot be labelled precisely is still a link worth offering.
 */
export interface SocialLink {
  type: string
  url: string
}

export interface ValidatorProfile {
  image?: string
  socials: SocialLink[]
}

interface CacheEntry {
  /** Absent image means "looked up, Keybase had nothing" — cached the same as
   *  a hit, since an identity with no picture is not worth asking about every
   *  session. */
  profile: ValidatorProfile
  at: number
}

function loadCache(): Record<string, CacheEntry> {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, CacheEntry>) : {}
  } catch {
    return {}
  }
}

function saveCache(cache: Record<string, CacheEntry>): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  } catch {
    // Costs a re-fetch next session, nothing more.
  }
}

interface KeybaseProof {
  proof_type?: string
  service_url?: string
  proof_url?: string
}

interface KeybaseLookupResponse {
  them?: Array<{
    pictures?: { primary?: { url?: string } }
    proofs_summary?: { all?: KeybaseProof[] }
  } | null> | null
}

/** One request in flight per identity, so several rows mounting at once do not
 *  each fire their own lookup. */
const inFlight = new Map<string, Promise<ValidatorProfile>>()

const EMPTY_PROFILE: ValidatorProfile = { socials: [] }

/**
 * Picture and verified social links for a validator's Keybase identity.
 *
 * One lookup covers both, cached together: a row's avatar and the fuller
 * profile a "manage this validator" panel wants are the same underlying fact,
 * and asking Keybase twice for it would just be asking twice.
 */
export async function fetchValidatorProfile(identity: string): Promise<ValidatorProfile> {
  const key = identity.trim()
  if (!key) return EMPTY_PROFILE

  // `cached.profile` guards against the previous cache shape (image URL only,
  // no socials) left over in someone's localStorage — treated as a miss
  // rather than crashing on a field that used to be at the top level.
  const cached = loadCache()[key]
  if (cached?.profile && Date.now() - cached.at < CACHE_TTL_MS) return cached.profile

  const pending = inFlight.get(key)
  if (pending) return pending

  const request = (async (): Promise<ValidatorProfile> => {
    try {
      const url = new URL(KEYBASE_LOOKUP)
      url.searchParams.set('key_suffix', key)
      url.searchParams.set('fields', 'pictures,proofs_summary')

      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS)
      })
      if (!response.ok) return EMPTY_PROFILE

      const body = (await response.json()) as KeybaseLookupResponse
      const them = body.them?.[0]

      const socials: SocialLink[] = (them?.proofs_summary?.all ?? [])
        .map((proof): SocialLink | undefined => {
          const proofUrl = proof.service_url || proof.proof_url
          return proof.proof_type && proofUrl ? { type: proof.proof_type, url: proofUrl } : undefined
        })
        .filter((link): link is SocialLink => link !== undefined)

      return { image: them?.pictures?.primary?.url || undefined, socials }
    } catch {
      return EMPTY_PROFILE
    }
  })()

  inFlight.set(key, request)
  try {
    const profile = await request
    const cache = loadCache()
    cache[key] = { profile, at: Date.now() }
    saveCache(cache)
    return profile
  } finally {
    inFlight.delete(key)
  }
}

/** Just the picture, for the places (a row, a picker) that only need that. */
export async function fetchValidatorImage(identity: string): Promise<string | undefined> {
  return (await fetchValidatorProfile(identity)).image
}

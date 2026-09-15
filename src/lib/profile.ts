import type { SecretNetworkClient } from 'secretjs'

import { PROFILE_REGISTRY_ADDRESS } from '@/chains/secret4'
import { codeHashFor } from '@/lib/codeHash'

/**
 * Client for the public profile registry (`contracts/profile`).
 *
 * Everything this module reads and writes is public. The query takes no permit
 * and no viewing key, because a profile exists so that someone handed a link
 * can see whose it is. What the chain's encryption still buys is that the
 * registry cannot be enumerated: you can ask about an address you have, and
 * there is no way to obtain the list of everyone who has ever saved one.
 *
 * The two things that leak whatever this module does, and that the UI has to
 * say out loud rather than bury: the transaction itself is public, so "this
 * account wrote to the profile registry at this time" is on chain forever; and
 * a published handle ties that identity to this address permanently, since
 * clearing a profile removes the current value but not the history.
 */

/** Mirrors the contract's limits. Both ends check; only the contract enforces. */
export const LIMITS = {
  name: 32,
  bio: 280,
  links: 8,
  linkValue: 200,
  /** Bytes of base64, matching `MAX_AVATAR` in the contract. */
  avatar: 12_288
} as const

export interface ProfileLink {
  kind: string
  value: string
}

export interface Profile {
  name: string
  bio: string
  /** A `data:image/webp;base64,…` URI, or empty. */
  avatar: string
  links: ProfileLink[]
  /** Block seconds of the last write. */
  updatedAt: number
}

/** A profile being edited: the same fields, before it has ever been saved. */
export type ProfileDraft = Omit<Profile, 'updatedAt'>

export const EMPTY_DRAFT: ProfileDraft = { name: '', bio: '', avatar: '', links: [] }

/**
 * The services the form offers, in the order it offers them.
 *
 * The contract stores `kind` as free text and has no opinion about which
 * services exist, so adding one here is the whole change — no migration, and
 * an older client meeting a kind it does not know shows the raw value rather
 * than dropping it.
 */
export const LINK_KINDS = [
  { kind: 'x', label: 'X', placeholder: 'handle', prefix: 'https://x.com/' },
  { kind: 'telegram', label: 'Telegram', placeholder: 'handle', prefix: 'https://t.me/' },
  { kind: 'github', label: 'GitHub', placeholder: 'handle', prefix: 'https://github.com/' },
  /*
   * No prefix: a Discord username is not addressable by URL, so it is shown to
   * be copied rather than followed. Inventing a link that 404s would be worse
   * than not offering one.
   */
  { kind: 'discord', label: 'Discord', placeholder: 'username', prefix: undefined },
  { kind: 'website', label: 'Website', placeholder: 'https://example.com', prefix: undefined }
] as const

/**
 * Where a link points, or `undefined` for one that is not followable.
 *
 * The website row is the reason this is not a string concatenation: its value
 * is a whole URL typed by the profile's owner and rendered on a page strangers
 * open, so the scheme is checked rather than trusted. `javascript:alert(1)` in
 * someone's website field would otherwise be a stored XSS on every visitor who
 * clicked it, and `data:` a phishing page served from this origin.
 */
export function linkHref(link: ProfileLink): string | undefined {
  const value = link.value.trim()
  if (!value) return undefined

  const kind = LINK_KINDS.find((candidate) => candidate.kind === link.kind)

  if (kind?.prefix) return `${kind.prefix}${value.replace(/^@/, '')}`
  if (kind && !kind.prefix && kind.kind !== 'website') return undefined

  // Bare domains are what people type; assume https rather than refusing them.
  const url = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : undefined
  } catch {
    return undefined
  }
}

/** Whether the registry has been deployed and wired up yet. */
export function registryConfigured(): boolean {
  return PROFILE_REGISTRY_ADDRESS !== ''
}

interface ProfileReply {
  name?: string
  bio?: string
  avatar?: string
  links?: Array<{ kind?: string; value?: string }>
  updated_at?: number
}

/**
 * A reply may be `null` for an account that never saved one, and this module
 * refuses to invent fields the contract did not send — a missing `name` becomes
 * an empty string here, not the address, because deciding what to show in place
 * of a name is the profile page's job and it already does it.
 */
function decode(reply: ProfileReply | null | undefined): Profile | undefined {
  if (!reply) return undefined

  return {
    name: reply.name ?? '',
    bio: reply.bio ?? '',
    avatar: reply.avatar ?? '',
    links: (reply.links ?? [])
      .filter((link): link is { kind: string; value: string } => Boolean(link?.kind && link?.value))
      .map((link) => ({ kind: link.kind, value: link.value })),
    updatedAt: reply.updated_at ?? 0
  }
}

/**
 * One account's profile, or `undefined` when it has none.
 *
 * An unconfigured registry answers `undefined` rather than throwing: before the
 * contract is deployed, nobody has a profile, which is exactly what the callers
 * would do with a failure anyway.
 */
export async function queryProfile(
  client: SecretNetworkClient,
  address: string
): Promise<Profile | undefined> {
  if (!registryConfigured()) return undefined

  const code_hash = await codeHashFor(client, PROFILE_REGISTRY_ADDRESS)
  const reply = (await client.query.compute.queryContract({
    contract_address: PROFILE_REGISTRY_ADDRESS,
    code_hash,
    query: { profile: { address } }
  })) as { profile?: ProfileReply | null }

  return decode(reply?.profile)
}

/**
 * Several at once, keyed by address. Addresses with no profile are simply
 * absent from the map.
 *
 * One round trip for a screen showing a list of accounts. The contract keeps
 * the nulls in its reply so the rows line up with what was asked; they are
 * dropped here because a `Map` says the same thing by not having the key.
 */
export async function queryProfiles(
  client: SecretNetworkClient,
  addresses: string[]
): Promise<Map<string, Profile>> {
  const found = new Map<string, Profile>()
  if (!registryConfigured() || addresses.length === 0) return found

  const code_hash = await codeHashFor(client, PROFILE_REGISTRY_ADDRESS)
  const reply = (await client.query.compute.queryContract({
    contract_address: PROFILE_REGISTRY_ADDRESS,
    code_hash,
    query: { profiles: { addresses } }
  })) as { profiles?: Array<{ address?: string; profile?: ProfileReply | null }> }

  for (const entry of reply?.profiles ?? []) {
    const profile = decode(entry?.profile)
    if (entry?.address && profile) found.set(entry.address, profile)
  }

  return found
}

/**
 * The execute message that saves a draft.
 *
 * Whole-record, matching the contract: a profile is edited in one form and
 * saved with one button, and a field-at-a-time API would turn that into five
 * transactions and five wallet prompts.
 */
export function setProfileMsg(draft: ProfileDraft): object {
  return {
    set: {
      name: draft.name.trim(),
      bio: draft.bio.trim(),
      avatar: draft.avatar,
      links: draft.links
        .map((link) => ({ kind: link.kind, value: link.value.trim() }))
        .filter((link) => link.value !== '')
    }
  }
}

export const clearProfileMsg = { clear: {} }

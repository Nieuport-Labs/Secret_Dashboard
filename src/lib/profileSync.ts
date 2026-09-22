import type { SecretNetworkClient } from 'secretjs'

import { queryProfile, type Profile } from '@/lib/profile'
import { fetchOffchain } from '@/lib/profileServer'
import { effectiveProfile, type OffchainProfile, type RecordProfile } from '@/lib/profileRecord'

/**
 * One account's profile from both places it can live — the registry contract
 * and the signed copy on the server — and which of them to believe.
 *
 * Every screen that shows a profile reads through here, and so does the
 * transaction path that writes a pending copy on chain, so there is one answer
 * to "does this account have something waiting?" rather than two that drift.
 *
 * Cached for the page like the code hashes are: a profile changes when its
 * owner saves, and saving goes through `remember`, which updates the entry and
 * tells whoever is showing it.
 */

export interface ProfileState {
  chain: Profile | undefined
  offchain: OffchainProfile | undefined
  /** What to show. */
  profile: RecordProfile | undefined
  /** The server holds something the chain does not say yet. */
  pending: boolean
  /**
   * Whether the chain actually answered. A write is only ever attached when it
   * did: with the chain unread, "pending" might be a copy older than what is
   * already on chain, and writing it would roll the profile back.
   */
  chainKnown: boolean
}

const cache = new Map<string, Promise<ProfileState>>()
const listeners = new Set<(address: string) => void>()

function settle(
  chain: Profile | undefined,
  offchain: OffchainProfile | undefined,
  chainKnown: boolean
): ProfileState {
  return { chain, offchain, chainKnown, ...effectiveProfile(chain, offchain) }
}

/**
 * Either source failing leaves the other standing. Both failing is "no
 * profile", which is what every caller would render for an error anyway — a
 * profile is decoration, never worth breaking a page over.
 */
export function profileState(client: SecretNetworkClient, address: string): Promise<ProfileState> {
  const cached = cache.get(address)
  if (cached) return cached

  const pending = Promise.allSettled([queryProfile(client, address), fetchOffchain(address)]).then(
    ([chain, offchain]) => {
      if (chain.status === 'rejected' && offchain.status === 'rejected') {
        // Not cached: the next look should try again.
        cache.delete(address)
      }
      return settle(
        chain.status === 'fulfilled' ? chain.value : undefined,
        offchain.status === 'fulfilled' ? offchain.value : undefined,
        chain.status === 'fulfilled'
      )
    }
  )

  cache.set(address, pending)
  return pending
}

function publish(address: string, state: ProfileState): void {
  cache.set(address, Promise.resolve(state))
  for (const listener of listeners) listener(address)
}

/** A freshly signed copy was stored; show it without asking the server again. */
export async function rememberOffchain(
  client: SecretNetworkClient,
  address: string,
  offchain: OffchainProfile
): Promise<void> {
  const current = await profileState(client, address)
  publish(address, settle(current.chain, offchain, current.chainKnown))
}

/**
 * The chain now says what the server copy said. Stated rather than re-read:
 * the node that answers the next query may be a block behind the one that
 * accepted the transaction.
 */
export async function rememberWritten(client: SecretNetworkClient, address: string): Promise<void> {
  const current = await profileState(client, address)
  const written = current.offchain?.body.profile
  const chain: Profile | undefined = written
    ? { ...written, updatedAt: Math.floor(Date.now() / 1000) }
    : undefined
  publish(address, settle(chain, current.offchain, true))
}

/** Drop an entry, so the next read goes back to both sources. */
export function forgetProfileState(address: string): void {
  cache.delete(address)
  for (const listener of listeners) listener(address)
}

export function onProfileChange(listener: (address: string) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

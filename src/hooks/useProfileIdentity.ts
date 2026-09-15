import { useEffect, useState } from 'react'
import type { SecretNetworkClient } from 'secretjs'

import { queryProfile, registryConfigured, type Profile, type ProfileLink } from '@/lib/profile'
import { useWallet } from '@/store/wallet'

/**
 * Who an address belongs to, as far as anyone else can tell.
 *
 * Read from the public profile registry (`contracts/profile`), which anyone can
 * query for any address — no permit, no viewing key. That is the whole point:
 * a profile is what turns a link someone was handed into a person.
 *
 * Everything is optional, and the callers already treat it that way. An account
 * with no profile — the common case, and the only case before the registry is
 * deployed — falls back to what an address alone produces: `shortenAddress` for
 * the name and `hueFor` for the picture, both deterministic, so the owner and
 * every visitor still see the same face.
 *
 * The local IndexedDB picture in `lib/profileImage.ts` is deliberately not
 * consulted here. It never leaves its browser, so using it would show the owner
 * an avatar no visitor can see, which is precisely the confusion a "save
 * onchain" button exists to remove.
 */

export interface ProfileIdentity {
  /** A display name, when the account has published one. */
  name?: string
  /**
   * An avatar every visitor can see — a `data:` URI held in contract state, not
   * the local picture, which by design cannot travel with a link.
   */
  avatarUrl?: string
  bio?: string
  links: ProfileLink[]
  /** True until the first answer arrives. Nothing here is worth a spinner, but
   *  it does separate "no profile" from "not asked yet". */
  loading: boolean
}

const NOBODY: ProfileIdentity = { links: [], loading: false }

/**
 * One in-flight or settled query per address, for the life of the page.
 *
 * A profile changes only when its owner signs a transaction, so re-querying on
 * every mount would spend requests to learn nothing. Saving invalidates the
 * entry directly, which covers the one case where the answer does go stale.
 */
const cache = new Map<string, Promise<Profile | undefined>>()

function fetchProfile(client: SecretNetworkClient, address: string): Promise<Profile | undefined> {
  const cached = cache.get(address)
  if (cached) return cached

  const pending = queryProfile(client, address).catch(() => {
    // Never cache a failure, and never let one break a page: a profile is
    // decoration on every screen that shows one.
    cache.delete(address)
    return undefined
  })

  cache.set(address, pending)
  return pending
}

/** Drop a cached answer, so the next read goes back to the chain. */
export function forgetProfile(address: string): void {
  cache.delete(address)
}

export function useProfileIdentity(address: string): ProfileIdentity {
  const client = useWallet((state) => state.queryClient)
  const [identity, setIdentity] = useState<ProfileIdentity>(NOBODY)

  useEffect(() => {
    if (!client || !address || !registryConfigured()) {
      setIdentity(NOBODY)
      return
    }

    let cancelled = false
    setIdentity({ links: [], loading: true })

    void fetchProfile(client, address).then((profile) => {
      if (cancelled) return
      setIdentity(
        profile
          ? {
              // Empty strings are how the contract spells "not set", and a name
              // of `''` would render as a blank heading rather than falling back
              // to the address.
              name: profile.name || undefined,
              avatarUrl: profile.avatar || undefined,
              bio: profile.bio || undefined,
              links: profile.links,
              loading: false
            }
          : NOBODY
      )
    })

    return () => {
      cancelled = true
    }
  }, [client, address])

  return identity
}

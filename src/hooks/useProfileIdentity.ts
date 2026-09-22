import { useEffect, useState } from 'react'

import type { ProfileLink } from '@/lib/profile'
import { onProfileChange, profileState } from '@/lib/profileSync'
import { useWallet } from '@/store/wallet'

/**
 * Who an address belongs to, as far as anyone else can tell.
 *
 * Read from the public profile registry (`contracts/profile`) and from the
 * signed copy an account without gas keeps on the server until its next
 * transaction writes it (`lib/profileSync.ts` decides which is current). Anyone
 * can read either for any address — no permit, no viewing key. That is the
 * whole point: a profile is what turns a link someone was handed into a person.
 *
 * Everything is optional, and the callers already treat it that way. An account
 * with no profile — the common case — falls back to what an address alone produces: `shortenAddress` for
 * the name and `hueFor` for the picture, both deterministic, so the owner and
 * every visitor still see the same face.
 *
 * The local IndexedDB picture in `lib/profileImage.ts` is deliberately not
 * consulted here. It never leaves its browser, so using it would show the owner
 * an avatar no visitor can see, which is precisely the confusion publishing a
 * profile exists to remove.
 */

export interface ProfileIdentity {
  /** A display name, when the account has published one. */
  name?: string
  /**
   * An avatar every visitor can see — a `data:` URI from the published profile,
   * not the local picture, which by design cannot travel with a link.
   */
  avatarUrl?: string
  bio?: string
  links: ProfileLink[]
  /** True until the first answer arrives. Nothing here is worth a spinner, but
   *  it does separate "no profile" from "not asked yet". */
  loading: boolean
}

const NOBODY: ProfileIdentity = { links: [], loading: false }

export function useProfileIdentity(address: string): ProfileIdentity {
  const client = useWallet((state) => state.queryClient)
  const [identity, setIdentity] = useState<ProfileIdentity>(NOBODY)
  // Bumped when this address's profile is saved elsewhere on the page, so the
  // header shows the new name without waiting for a remount.
  const [revision, setRevision] = useState(0)

  useEffect(
    () => onProfileChange((changed) => changed === address && setRevision((value) => value + 1)),
    [address]
  )

  useEffect(() => {
    if (!client || !address) {
      setIdentity(NOBODY)
      return
    }

    let cancelled = false
    setIdentity({ links: [], loading: true })

    void profileState(client, address).then(({ profile }) => {
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
  }, [client, address, revision])

  return identity
}

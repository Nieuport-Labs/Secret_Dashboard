import { useEffect, useState } from 'react'

import { mapWithLimit } from '@/lib/concurrency'
import { fetchValidatorImage } from '@/lib/validatorImage'
import type { Validator } from '@/lib/staking'

/** How many Keybase lookups run at once. This hits a third party's API, not
 *  this app's own infrastructure, so it stays modest even though secret-4 only
 *  has a couple dozen bonded validators to ask about. */
const CONCURRENCY = 6

/**
 * Avatars for a validator list, keyed by identity.
 *
 * Only fetched for validators that actually published a Keybase identity —
 * roughly half typically don't, and an empty one is simply skipped rather than
 * looked up and shown as a blank.
 */
export function useValidatorImages(validators: Validator[]): Map<string, string> {
  const [images, setImages] = useState<Map<string, string>>(new Map())

  // A stable string, so the effect does not refire on every render just
  // because `validators` is a new array — the staking hook rebuilds it on
  // every refresh even when nothing about the list of identities changed.
  const identities = [...new Set(validators.map((v) => v.identity).filter((id): id is string => !!id))]
  const key = identities.join(',')

  useEffect(() => {
    if (identities.length === 0) {
      setImages(new Map())
      return
    }

    let cancelled = false
    void mapWithLimit(
      identities,
      CONCURRENCY,
      async (identity) => [identity, await fetchValidatorImage(identity)] as const
    ).then((results) => {
      if (cancelled) return
      setImages(new Map(results.filter((entry): entry is [string, string] => Boolean(entry[1]))))
    })

    return () => {
      cancelled = true
    }
    // `key` is the real dependency — see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return images
}

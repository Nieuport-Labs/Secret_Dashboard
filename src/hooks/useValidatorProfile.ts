import { useEffect, useState } from 'react'

import { fetchValidatorProfile, type ValidatorProfile } from '@/lib/validatorImage'

/**
 * The fuller Keybase profile for one validator — picture and verified social
 * links — fetched on demand rather than for the whole list up front.
 *
 * The list view (`useValidatorImages`) already warms the same cache with just
 * the picture, so opening a panel for a validator whose row has already
 * rendered costs nothing further here; this only does its own network work
 * the first time that particular identity is asked about.
 */
export function useValidatorProfile(identity: string | undefined): ValidatorProfile | undefined {
  const [profile, setProfile] = useState<ValidatorProfile | undefined>()

  useEffect(() => {
    setProfile(undefined)
    if (!identity) return

    let cancelled = false
    void fetchValidatorProfile(identity).then((result) => {
      if (!cancelled) setProfile(result)
    })
    return () => {
      cancelled = true
    }
  }, [identity])

  return profile
}

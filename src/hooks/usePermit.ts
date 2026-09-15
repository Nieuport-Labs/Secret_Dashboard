import { useCallback, useEffect, useMemo, useState } from 'react'

import { errorMessage } from '@/lib/errors'
import {
  DEFAULT_PERMISSIONS,
  forgetPermit,
  loadPermit,
  missingPermissions,
  missingTokens,
  PERMIT_NAME,
  savePermit,
  signPermit,
  surplusPermissions,
  STAKING_PERMISSIONS,
  STAKING_PERMIT_NAME,
  type Permit,
  type PermitPermission
} from '@/lib/permit'
import { allTokenAddresses, STKD_SCRT_ADDRESS } from '@/tokens/registry'
import { getProvider } from '@/lib/wallet'
import { useWallet } from '@/store/wallet'

interface PermitScope {
  /** Suffix on the storage key. Absent for the registry-wide permit. */
  scope?: string
  name: string
  tokens: () => string[]
  permissions: PermitPermission[]
}

const REGISTRY_SCOPE: PermitScope = {
  name: PERMIT_NAME,
  tokens: allTokenAddresses,
  permissions: DEFAULT_PERMISSIONS
}

/**
 * Shade's staking derivative, on its own.
 *
 * Separate because its permission vocabulary is not the standard one — see
 * `STAKING_PERMISSIONS`. Keeping it apart is also the honest arrangement: this
 * signature buys one contract's queue and nothing else, and an account with no
 * position never has to give it.
 */
export const STAKING_SCOPE: PermitScope = {
  scope: 'staking',
  name: STAKING_PERMIT_NAME,
  tokens: () => [STKD_SCRT_ADDRESS],
  permissions: STAKING_PERMISSIONS
}

/**
 * The signed permit for the connected account, if there is one.
 *
 * A permit names both the tokens it covers and the permissions it grants, and a
 * stored one can fall behind on either: a token added to the registry since it
 * was signed is not covered, and neither is a read this app has started making
 * since. `staleTokens` and `stalePermissions` surface the two, which turns an
 * opaque contract error into an honest "sign again to include these".
 */
export function usePermit(scope: PermitScope = REGISTRY_SCOPE) {
  const address = useWallet((state) => state.address)
  const walletId = useWallet((state) => state.walletId)

  const [permit, setPermit] = useState<Permit | undefined>()
  const [signing, setSigning] = useState(false)
  const [error, setError] = useState<string | undefined>()

  const { scope: key, name, tokens, permissions } = scope

  // A permit belongs to one address. Switching account must not carry it over.
  //
  // A stored permit granting more than this scope asks for is dropped rather
  // than used: a contract refuses an unknown permission outright, so a permit
  // with a surplus one is not a permissive permit, it is a broken one. See
  // `surplusPermissions`.
  useEffect(() => {
    if (!address) {
      setPermit(undefined)
      setError(undefined)
      return
    }

    const stored = loadPermit(address, key)
    if (stored && surplusPermissions(stored, permissions).length > 0) {
      forgetPermit(address, key)
      setPermit(undefined)
    } else {
      setPermit(stored)
    }
    setError(undefined)
  }, [address, key, permissions])

  const sign = useCallback(async () => {
    if (!address || !walletId) return
    const provider = getProvider(walletId)
    if (!provider) {
      setError('The wallet extension is no longer available.')
      return
    }

    setSigning(true)
    setError(undefined)
    try {
      const signed = await signPermit(provider, address, tokens(), permissions, name)
      savePermit(address, signed, key)
      setPermit(signed)
    } catch (caught) {
      const message = errorMessage(caught)
      // Declining the signature is a choice, not a fault. Saying "Request
      // rejected" as an error implies something broke.
      setError(/reject|denied|cancell?ed/i.test(message) ? undefined : message)
    } finally {
      setSigning(false)
    }
  }, [address, walletId, key, name, tokens, permissions])

  const forget = useCallback(() => {
    if (!address) return
    forgetPermit(address, key)
    setPermit(undefined)
  }, [address, key])

  const staleTokens = useMemo(() => missingTokens(permit, tokens()), [permit, tokens])

  return {
    permit,
    /** Tokens in this scope the permit does not cover; signing again fixes it. */
    staleTokens,
    /** Permissions this scope now asks for that the stored permit never granted. */
    stalePermissions: permit ? missingPermissions(permit, permissions) : [],
    signing,
    error,
    sign,
    /** Drop the local copy. Does not revoke on chain — that needs a transaction. */
    forget
  }
}

import { useCallback, useEffect, useState } from 'react'

import { errorMessage } from '@/lib/errors'
import { forgetPermit, loadPermit, missingTokens, savePermit, signPermit, type Permit } from '@/lib/permit'
import { allTokenAddresses } from '@/tokens/registry'
import { getProvider } from '@/lib/wallet'
import { useWallet } from '@/store/wallet'

/**
 * The signed permit for the connected account, if there is one.
 *
 * A permit names the tokens it covers, so one signed before a token was added
 * to the registry does not cover that token. `staleTokens` surfaces that, which
 * turns an opaque contract error into an honest "sign again to include these".
 */
export function usePermit() {
  const address = useWallet((state) => state.address)
  const walletId = useWallet((state) => state.walletId)

  const [permit, setPermit] = useState<Permit | undefined>()
  const [signing, setSigning] = useState(false)
  const [error, setError] = useState<string | undefined>()

  // A permit belongs to one address. Switching account must not carry it over.
  useEffect(() => {
    setPermit(address ? loadPermit(address) : undefined)
    setError(undefined)
  }, [address])

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
      const signed = await signPermit(provider, address, allTokenAddresses())
      savePermit(address, signed)
      setPermit(signed)
    } catch (caught) {
      const message = errorMessage(caught)
      // Declining the signature is a choice, not a fault. Saying "Request
      // rejected" as an error implies something broke.
      setError(/reject|denied|cancell?ed/i.test(message) ? undefined : message)
    } finally {
      setSigning(false)
    }
  }, [address, walletId])

  const forget = useCallback(() => {
    if (!address) return
    forgetPermit(address)
    setPermit(undefined)
  }, [address])

  return {
    permit,
    /** Registry tokens this permit does not cover; signing again fixes it. */
    staleTokens: missingTokens(permit, allTokenAddresses()),
    signing,
    error,
    sign,
    /** Drop the local copy. Does not revoke on chain — that needs a transaction. */
    forget
  }
}

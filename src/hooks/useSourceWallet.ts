import { useCallback, useEffect, useState } from 'react'

import type { SourceChain } from '@/chains/sources'
import { OSMOSIS_CHAIN_ID } from '@/chains/sources'
import { describeNetworkError } from '@/lib/endpoint'
import { getProvider } from '@/lib/wallet'
import { useWallet } from '@/store/wallet'

/**
 * The user's address and balance on the chain they are bridging from.
 *
 * Bridging in is signed on the *source* chain, not on Secret, so this is a
 * second wallet connection: the same key, a different chain and a different
 * bech32 prefix. Keplr and StarShell both hand it over once the chain is
 * enabled.
 *
 * The Osmosis address is fetched alongside, because "Get gas" needs it as the
 * recovery address for a failed swap and it comes from the same key.
 */
export function useSourceWallet(chain: SourceChain | undefined) {
  const walletId = useWallet((state) => state.walletId)

  const [address, setAddress] = useState<string | undefined>()
  const [osmosisAddress, setOsmosisAddress] = useState<string | undefined>()
  const [balance, setBalance] = useState<string | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [connecting, setConnecting] = useState(false)

  const connect = useCallback(async () => {
    if (!chain || !walletId) return
    const provider = getProvider(walletId)
    if (!provider) {
      setError('The wallet extension is no longer available.')
      return
    }

    setConnecting(true)
    setError(undefined)
    try {
      // Enabling both at once means one approval prompt rather than two.
      await provider.enable(chain.chainId)
      const key = await provider.getKey(chain.chainId)
      setAddress(key.bech32Address)

      // Osmosis is only needed as the recovery address for the gas leg. A
      // wallet that does not know the chain is not an error worth surfacing —
      // it just means "Get gas" cannot be offered.
      try {
        await provider.enable(OSMOSIS_CHAIN_ID)
        const osmo = await provider.getKey(OSMOSIS_CHAIN_ID)
        setOsmosisAddress(osmo.bech32Address)
      } catch {
        setOsmosisAddress(undefined)
      }
    } catch (caught) {
      setError(describeNetworkError(caught))
      setAddress(undefined)
    } finally {
      setConnecting(false)
    }
  }, [chain, walletId])

  // Switching chain invalidates the address; nothing here survives it.
  useEffect(() => {
    setAddress(undefined)
    setBalance(undefined)
    setError(undefined)
  }, [chain?.chainId])

  // The balance on the source chain decides what can be bridged, and the LCD
  // there is not one this app probes — a failure is reported, not retried.
  useEffect(() => {
    if (!chain || !address) return

    let cancelled = false
    const denom = chain.feeDenom

    void fetch(
      `${chain.lcd.replace(/\/+$/, '')}/cosmos/bank/v1beta1/balances/${address}/by_denom?denom=${denom}`,
      {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000)
      }
    )
      .then((response) =>
        response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))
      )
      .then((body: { balance?: { amount?: string } }) => {
        if (!cancelled) setBalance(body.balance?.amount ?? '0')
      })
      .catch(() => {
        if (!cancelled) setBalance(undefined)
      })

    return () => {
      cancelled = true
    }
  }, [chain, address])

  return { address, osmosisAddress, balance, connect, connecting, error }
}

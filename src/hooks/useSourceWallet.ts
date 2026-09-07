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
  const [balances, setBalances] = useState<Map<string, string>>(new Map())
  const [error, setError] = useState<string | undefined>()
  const [connecting, setConnecting] = useState(false)
  const [nonce, setNonce] = useState(0)

  /** Re-read balances without a full reconnect — call after sending, so a
   *  deposit or withdrawal shows up without waiting for a remount. */
  const refresh = useCallback(() => setNonce((n) => n + 1), [])

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
      // Enabling both at once means one approval prompt rather than two. Once
      // Keplr/StarShell has approved a chain, this resolves silently on every
      // later call — no popup — which is what makes the auto-reconnect below
      // invisible in the ordinary case.
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

  // Switching chain invalidates the address; nothing here survives it. Then
  // reconnect right away rather than waiting for another click — once a chain
  // has been approved in the wallet extension, `connect` resolves without a
  // prompt, so re-asking for it on every visit was pure friction, not a real
  // permission check.
  useEffect(() => {
    setAddress(undefined)
    setBalance(undefined)
    setBalances(new Map())
    setError(undefined)
    if (chain && walletId) void connect()
    // `connect` changes reference only when `chain`/`walletId` do, so this
    // does not loop.
  }, [chain, walletId, connect])

  // The balances on the source chain: every denomination held, not just the
  // fee one, so the token picker can show what each choice is actually worth
  // without a separate query per token.
  useEffect(() => {
    if (!chain || !address) return

    let cancelled = false

    void fetch(
      `${chain.lcd.replace(/\/+$/, '')}/cosmos/bank/v1beta1/balances/${address}?pagination.limit=200`,
      {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000)
      }
    )
      .then((response) =>
        response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))
      )
      .then((body: { balances?: { denom: string; amount: string }[] }) => {
        if (cancelled) return
        const held = new Map((body.balances ?? []).map((coin) => [coin.denom, coin.amount]))
        setBalances(held)
        setBalance(held.get(chain.feeDenom) ?? '0')
      })
      .catch(() => {
        if (!cancelled) {
          setBalances(new Map())
          setBalance(undefined)
        }
      })

    return () => {
      cancelled = true
    }
  }, [chain, address, nonce])

  return { address, osmosisAddress, balance, balances, connect, connecting, error, refresh }
}

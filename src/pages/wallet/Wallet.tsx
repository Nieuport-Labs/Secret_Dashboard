import { KeyRound, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'

import Button from '@/components/ui/Button'
import { DISPLAY_DENOM } from '@/chains/secret4'
import { usePermit } from '@/hooks/usePermit'
import { formatAmount } from '@/lib/format'
import { queryBalance, type BalanceOutcome } from '@/lib/snip20'
import { SSCRT_ADDRESS, tokenByAddress } from '@/tokens/registry'
import { useWallet } from '@/store/wallet'

/**
 * The connected wallet.
 *
 * Phase 2 scope: prove the permit path end to end, by reading an sSCRT balance
 * with no viewing key and no transaction. Phase 3 builds this into the design's
 * full screen (profile photo, QR, the action row, every balance).
 */
export default function Wallet() {
  const address = useWallet((state) => state.address)
  const accountName = useWallet((state) => state.accountName)
  const queryClient = useWallet((state) => state.queryClient)
  const disconnect = useWallet((state) => state.disconnect)
  const { permit, signing, error, sign } = usePermit()

  const [balance, setBalance] = useState<BalanceOutcome | undefined>()
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!permit || !queryClient) {
      setBalance(undefined)
      return
    }

    let cancelled = false
    setLoading(true)
    void queryBalance(queryClient, permit, SSCRT_ADDRESS)
      .then((outcome) => {
        if (!cancelled) setBalance(outcome)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [permit, queryClient])

  if (!address) return null

  const sscrt = tokenByAddress(SSCRT_ADDRESS)

  return (
    <section className="mx-auto flex max-w-[720px] flex-col gap-8">
      <header>
        <h1 className="text-3xl font-semibold">Hello 👋</h1>
        <p className="break-address mt-1 text-base text-text-muted">{address}</p>
        {accountName ? <p className="mt-1 text-base text-text-faint">{accountName}</p> : null}
      </header>

      <div className="rounded-card bg-surface-2 p-6">
        {!permit ? (
          <div className="flex flex-col items-start gap-4">
            <div className="flex items-start gap-3">
              <KeyRound size={20} aria-hidden className="mt-0.5 shrink-0 text-accent" />
              <div>
                <h2 className="text-lg font-medium">Sign a query permit</h2>
                <p className="mt-1 text-base text-text-muted">
                  Reading your own token balances needs your signature, not a transaction. Nothing is written
                  to the chain and there is no fee.
                </p>
              </div>
            </div>
            <Button variant="primary" size="md" loading={signing} onClick={() => void sign()}>
              Sign permit
            </Button>
            {error ? (
              <p className="text-base text-negative" role="alert">
                {error}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2 text-base text-text-muted">
              <ShieldCheck size={18} aria-hidden className="text-positive" />
              Permit signed, covering {permit.params.allowed_tokens.length} tokens
            </div>

            <div className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-2.5">
                {sscrt ? (
                  <img src={`/img/tokens/${sscrt.image}`} alt="" className="size-8 rounded-pill" />
                ) : null}
                <span className="text-base font-medium">s{DISPLAY_DENOM}</span>
              </span>
              <BalanceReadout loading={loading} outcome={balance} decimals={sscrt?.decimals ?? 6} />
            </div>
          </div>
        )}
      </div>

      <div>
        <Button variant="ghost" size="sm" onClick={disconnect}>
          Disconnect
        </Button>
      </div>
    </section>
  )
}

/**
 * Every outcome gets its own words. "0" and "could not read" look identical on
 * screen and only one of them is safe to act on, so they never share a state.
 */
function BalanceReadout({
  loading,
  outcome,
  decimals
}: {
  loading: boolean
  outcome: BalanceOutcome | undefined
  decimals: number
}) {
  if (loading) return <span className="h-6 w-24 animate-pulse rounded-control bg-surface" />
  if (!outcome) return null

  switch (outcome.status) {
    case 'ok':
      return <span className="text-lg font-medium">{formatAmount(outcome.amount, { decimals })}</span>
    case 'not-covered':
      return <span className="text-base text-text-muted">Not covered by this permit</span>
    case 'unauthorized':
      return <span className="text-base text-text-muted">The token rejected the permit</span>
    case 'error':
      return <span className="text-base text-text-muted">Could not read</span>
  }
}

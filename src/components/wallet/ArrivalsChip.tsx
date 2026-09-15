import { Loader2, RadioTower, Timer } from 'lucide-react'

import { useWalletData } from '@/hooks/walletData'
import { cn } from '@/lib/cn'
import { useWallet } from '@/store/wallet'

/**
 * Whether arrivals show up the instant they happen — and the way to re-read
 * every token in the registry.
 *
 * Two things on one control because they are the same question asked twice.
 * "Live" is the claim that nothing can arrive without this screen saying so;
 * pressing it is what you do when you doubt the claim. The alternative was a
 * status word beside a button that repeated it, which is what used to sit above
 * the token list.
 *
 * It lives in the header rather than on the wallet screen: the sweep now runs
 * for the whole app, and a status that disappears when you open Bridge is a
 * status you cannot trust while you are waiting for something.
 */
export default function ArrivalsChip() {
  const address = useWallet((state) => state.address)
  const { pushStatus, balances } = useWalletData()

  if (!address) return null

  const { scanning, scanProgress, scanAll } = balances
  const [done, total] = scanProgress

  const live = pushStatus === 'live'
  const label = scanning
    ? total > 0
      ? `Scanning ${done}/${total}`
      : 'Scanning'
    : pushStatus === 'live'
      ? 'Live'
      : pushStatus === 'connecting'
        ? 'Connecting…'
        : 'Periodic'

  const title = scanning
    ? 'Reading every token in the registry'
    : pushStatus === 'live'
      ? 'Arrivals appear immediately. Check every token in the registry now.'
      : pushStatus === 'off'
        ? 'Push notifications are off; balances refresh every couple of minutes. Check every token now.'
        : 'Push is unavailable; balances refresh every couple of minutes. Check every token now.'

  return (
    <button
      type="button"
      onClick={scanAll}
      disabled={scanning}
      title={title}
      className={cn(
        'state-layer flex items-center gap-1.5 rounded-control px-2.5 py-1.5 text-base font-medium',
        'disabled:cursor-default',
        live && !scanning ? 'text-positive' : 'text-text-muted'
      )}
    >
      {scanning ? (
        <Loader2 size={14} aria-hidden className="motion-safe:animate-spin" />
      ) : live ? (
        <RadioTower size={14} aria-hidden />
      ) : (
        <Timer size={14} aria-hidden />
      )}
      {label}
    </button>
  )
}

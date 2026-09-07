import { useState } from 'react'

import { DISPLAY_DENOM } from '@/chains/secret4'
import { cn } from '@/lib/cn'

interface Props {
  /** Base units (uscrt). */
  totalSupply: string
  /** Base units (uscrt). */
  bonded: string
  /** Base units (uscrt). */
  communityPool?: string
  /** Display units — from Lavender.Five, not the chain itself. */
  unbondingTotal?: number
  /** Display units — from Lavender.Five, not the chain itself. */
  ibcOut?: number
}

interface Segment {
  label: string
  amount: number
  /** Fixed rather than drawn from the theme's tokens — those are deliberately
   *  a near-monochrome palette (one accent), which is right for the rest of
   *  the app but leaves adjacent slices here almost impossible to tell apart. */
  color: string
  text: string
}

function toDisplay(baseUnits: string): number {
  return Number(BigInt(baseUnits)) / 1e6
}

function formatScrt(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 })
}

/**
 * Where the total supply currently sits, as one proportional-width bar — a
 * single-row Marimekko rather than the two-axis kind, since there is only one
 * quantity being split here. Widths are true to scale; nothing gets a floor
 * width to stay visible, because a category too small to see is itself the
 * fact worth showing (Secret's community pool usually is).
 *
 * "Held on other chains" and the unbonding queue come from Lavender.Five,
 * riding along on the same call the Unbonding chart already makes — the chain
 * itself only knows what is bonded right now, not what is mid-transfer or
 * mid-unbond elsewhere.
 */
export default function SupplyBreakdown({ totalSupply, bonded, communityPool, unbondingTotal, ibcOut }: Props) {
  const [hovered, setHovered] = useState<string | undefined>()

  const total = toDisplay(totalSupply)
  if (total <= 0) {
    return (
      <p className="flex items-center justify-center text-label text-text-faint" style={{ height: 200 }}>
        No breakdown available.
      </p>
    )
  }

  const bondedAmount = toDisplay(bonded)
  const communityAmount = communityPool ? toDisplay(communityPool) : 0
  const unbondingAmount = unbondingTotal ?? 0
  const ibcAmount = ibcOut ?? 0
  const liquid = Math.max(total - bondedAmount - communityAmount - unbondingAmount - ibcAmount, 0)

  const segments: Segment[] = [
    { label: 'Liquid', amount: liquid, color: '#8b93a3', text: '#0a0a0a' },
    { label: 'Staked', amount: bondedAmount, color: 'var(--color-accent)', text: 'var(--color-accent-text)' },
    { label: 'Unbonding', amount: unbondingAmount, color: '#e8b13c', text: '#0a0a0a' },
    { label: 'Held on other chains', amount: ibcAmount, color: '#4f8fe8', text: '#ffffff' },
    { label: 'Community pool', amount: communityAmount, color: 'var(--color-positive)', text: '#ffffff' }
  ].filter((segment) => segment.amount > 0)

  return (
    <div className="flex flex-col gap-5">
      <div
        className="flex h-14 w-full overflow-hidden rounded-control"
        role="img"
        aria-label={`Total supply of ${formatScrt(total)} ${DISPLAY_DENOM}, split by where it currently sits: ${segments
          .map((segment) => `${segment.label} ${((segment.amount / total) * 100).toFixed(2)}%`)
          .join(', ')}.`}
      >
        {segments.map((segment) => (
          <div
            key={segment.label}
            style={{
              flexGrow: segment.amount,
              backgroundColor: segment.color,
              opacity: hovered === undefined || hovered === segment.label ? 1 : 0.3
            }}
            className="h-full min-w-[2px] transition-opacity duration-[var(--duration-short)] ease-[var(--ease-standard)]"
            onPointerEnter={() => setHovered(segment.label)}
            onPointerLeave={() => setHovered(undefined)}
            title={`${segment.label}: ${formatScrt(segment.amount)} ${DISPLAY_DENOM} (${(
              (segment.amount / total) *
              100
            ).toFixed(2)}%)`}
          />
        ))}
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        {segments.map((segment) => (
          <div
            key={segment.label}
            onPointerEnter={() => setHovered(segment.label)}
            onPointerLeave={() => setHovered(undefined)}
            className={cn(
              'flex cursor-default items-start gap-2 transition-opacity duration-[var(--duration-short)] ease-[var(--ease-standard)]',
              hovered !== undefined && hovered !== segment.label && 'opacity-30'
            )}
          >
            <span
              aria-hidden
              className="mt-1.5 size-2.5 shrink-0 rounded-pill"
              style={{ backgroundColor: segment.color }}
            />
            <span className="min-w-0">
              <span className="block text-label text-text-muted">{segment.label}</span>
              <span className="block truncate text-body font-medium tabular-nums">
                {formatScrt(segment.amount)} {DISPLAY_DENOM}
              </span>
              <span className="block text-label text-text-faint">
                {((segment.amount / total) * 100).toFixed(2)}%
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

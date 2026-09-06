import { Repeat } from 'lucide-react'

import Button from '@/components/ui/Button'
import { DISPLAY_DENOM } from '@/chains/secret4'
import { formatAmount } from '@/lib/format'
import { cn } from '@/lib/cn'
import type { Delegation, Reward, Validator } from '@/lib/staking'

interface Props {
  validator: Validator
  delegation?: Delegation
  reward?: Reward
  /** Auto-restake state, including a change staged but not yet sent. */
  restaking: boolean
  restakeChanged: boolean
  /** Minimum delegation the chain will restake, in base units. */
  restakeThreshold?: string
  onToggleRestake: () => void
  onManage: () => void
}

export default function ValidatorRow({
  validator,
  delegation,
  reward,
  restaking,
  restakeChanged,
  restakeThreshold,
  onToggleRestake,
  onManage
}: Props) {
  const staked = delegation ? BigInt(delegation.amount) : 0n

  /*
   * Below the chain's threshold, MsgSetAutoRestake is accepted and then does
   * nothing. Offering an switch that silently fails is worse than not offering
   * one, so it is disabled with the reason given.
   */
  const belowThreshold = restakeThreshold !== undefined && staked < BigInt(restakeThreshold)
  const canRestake = staked > 0n && !belowThreshold

  return (
    /*
      The name takes a full row of its own below `sm`. Sharing one line with the
      figures and the buttons squeezes it to two letters, and a validator you
      cannot read is one you cannot choose between.
    */
    <li className="flex flex-col gap-3 rounded-card bg-surface-1 px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4">
      <span className="min-w-0 sm:flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-base font-medium">{validator.moniker}</span>
          {validator.jailed ? (
            <span className="shrink-0 rounded-control bg-surface px-1.5 py-0.5 text-xs text-negative">
              jailed
            </span>
          ) : null}
        </span>
        <span className="block text-sm text-text-faint">
          {(validator.commission * 100).toFixed(1)}% commission ·{' '}
          {formatAmount(validator.tokens, { maxFractionDigits: 0 })} {DISPLAY_DENOM} staked
        </span>
      </span>

      {staked > 0n ? (
        <span className="sm:text-right">
          <span className="block text-base font-medium">
            {formatAmount(delegation!.amount)} {DISPLAY_DENOM}
          </span>
          {reward ? (
            <span className="block text-sm text-positive">+{formatAmount(reward.amount)} earned</span>
          ) : null}
        </span>
      ) : null}

      {staked > 0n ? (
        <button
          type="button"
          onClick={onToggleRestake}
          disabled={!canRestake}
          title={
            belowThreshold
              ? `Auto-restake needs at least ${formatAmount(restakeThreshold!)} ${DISPLAY_DENOM} with this validator. The chain accepts the setting below that but does not act on it.`
              : 'Compound rewards automatically'
          }
          className={cn(
            'state-layer flex items-center gap-1.5 rounded-control px-2.5 py-1.5 text-sm',
            restaking ? 'bg-accent-container text-accent' : 'bg-surface text-text-muted',
            restakeChanged && 'ring-1 ring-accent',
            !canRestake && 'cursor-not-allowed opacity-50'
          )}
        >
          <Repeat size={14} aria-hidden />
          {restaking ? 'Auto-restaking' : 'Auto-restake'}
        </button>
      ) : null}

      <Button variant="soft" shape="control" size="sm" onClick={onManage}>
        {staked > 0n ? 'Manage' : 'Stake'}
      </Button>
    </li>
  )
}

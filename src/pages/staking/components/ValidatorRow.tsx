import { Check, Coins, Copy, ExternalLink, MoreHorizontal, Repeat } from 'lucide-react'
import { useState } from 'react'

import Menu, { MenuItem } from '@/components/ui/Menu'
import ValidatorAvatar from '@/pages/staking/components/ValidatorAvatar'
import { DISPLAY_DENOM, explorerValidatorUrl } from '@/chains/secret4'
import { formatDisplayAmount } from '@/lib/format'
import type { Delegation, Reward, Validator } from '@/lib/staking'

interface Props {
  validator: Validator
  delegation?: Delegation
  reward?: Reward
  image?: string
  /** This validator's share of everything bonded on the chain, as a fraction. */
  networkShare?: number
  /**
   * What the right-hand column is about. "Your validators" is a short, fixed
   * list where the figure that matters is what you put in; "All validators"
   * is everyone, most of whom you hold nothing with, so the figure that
   * applies to all of them is their share of the network instead.
   */
  column: 'staked' | 'votingPower'
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
  image,
  networkShare,
  column,
  restaking,
  restakeChanged,
  restakeThreshold,
  onToggleRestake,
  onManage
}: Props) {
  const [copied, setCopied] = useState(false)
  const staked = delegation ? BigInt(delegation.amount) : 0n

  /*
   * Below the chain's threshold, MsgSetAutoRestake is accepted and then does
   * nothing. Offering a switch that silently fails is worse than not offering
   * one, so it is disabled with the reason given.
   */
  const belowThreshold = restakeThreshold !== undefined && staked < BigInt(restakeThreshold)
  const canRestake = staked > 0n && !belowThreshold

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(validator.address)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // Clipboard access can be refused. The explorer link the menu also
      // offers has the address on it too.
    }
  }

  return (
    /*
      The whole row opens the card — clicking a validator is the point of the
      row, not something buried in the menu below. `role="button"` plus its
      own key handling rather than a real `<button>` wrapping everything: the
      menu underneath is itself interactive, and a button cannot contain
      another one. Not a `state-layer` — that sets `overflow: hidden`, which
      would cut the menu's own dropdown off at the row's edge. The menu's
      click is stopped from bubbling up to this, so opening it does not also
      open the card behind it.
    */
    <li
      role="button"
      tabIndex={0}
      onClick={onManage}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onManage()
        }
      }}
      className="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-2.5 rounded-control px-2 py-3 transition-colors duration-[var(--duration-short)] ease-[var(--ease-standard)] hover:bg-surface-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <span className="flex min-w-0 flex-1 items-center gap-3">
        <ValidatorAvatar address={validator.address} moniker={validator.moniker} image={image} />

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-body font-medium">{validator.moniker}</span>
            {validator.jailed ? (
              <span className="shrink-0 rounded-pill bg-surface px-1.5 py-px text-[0.6875rem] font-medium leading-[1.4] text-negative">
                Jailed
              </span>
            ) : null}
            {restaking ? (
              <span
                className="shrink-0 rounded-pill bg-accent-container px-1.5 py-px text-[0.6875rem] font-medium leading-[1.4] text-accent"
                title="Rewards here compound automatically"
              >
                Auto-restake
              </span>
            ) : null}
          </span>
          <span className="block truncate text-label text-text-faint">
            {(validator.commission * 100).toFixed(1)}% commission
          </span>
        </span>
      </span>

      {column === 'staked' ? (
        staked > 0n ? (
          <span className="w-24 shrink-0 text-right sm:w-32">
            <span className="block text-body font-medium tabular-nums">
              {formatDisplayAmount(delegation!.amount)} {DISPLAY_DENOM}
            </span>
            {reward ? (
              <span className="block text-label tabular-nums text-positive">
                +{formatDisplayAmount(reward.amount)} earned
              </span>
            ) : null}
          </span>
        ) : null
      ) : (
        <span className="w-24 shrink-0 text-right sm:w-32">
          <span className="block text-body font-medium tabular-nums">
            {networkShare !== undefined ? `${(networkShare * 100).toFixed(2)}%` : '—'}
          </span>
        </span>
      )}

      {/* Stops the click here from also reaching the row's own onClick above. */}
      <span
        onClick={(event) => event.stopPropagation()}
        className="flex shrink-0 items-center justify-end sm:w-10"
      >
        <Menu
          label={`Actions for ${validator.moniker}`}
          triggerClassName="flex size-8 items-center justify-center rounded-pill text-text-muted"
          trigger={<MoreHorizontal size={18} aria-hidden />}
        >
          <MenuItem icon={<Coins size={16} aria-hidden />} onClick={onManage}>
            {staked > 0n ? 'Manage' : 'Stake'}
          </MenuItem>

          {staked > 0n ? (
            <MenuItem
              icon={
                <Repeat size={16} aria-hidden className={restaking ? 'text-accent' : undefined} />
              }
              disabled={!canRestake}
              title={
                belowThreshold
                  ? `Needs at least ${formatDisplayAmount(restakeThreshold!)} ${DISPLAY_DENOM} staked here. The chain accepts the setting below that but does not act on it.`
                  : undefined
              }
              onClick={onToggleRestake}
            >
              {restaking ? 'Turn off auto-restake' : 'Turn on auto-restake'}
              {restakeChanged ? <Check size={14} aria-hidden className="ml-auto text-accent" /> : null}
            </MenuItem>
          ) : null}

          <MenuItem icon={<Copy size={16} aria-hidden />} onClick={() => void copyAddress()}>
            {copied ? 'Copied' : 'Copy address'}
          </MenuItem>

          <MenuItem
            icon={<ExternalLink size={16} aria-hidden />}
            onClick={() => window.open(explorerValidatorUrl(validator.address), '_blank', 'noreferrer,noopener')}
          >
            View on explorer
          </MenuItem>
        </Menu>
      </span>
    </li>
  )
}

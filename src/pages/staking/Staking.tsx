import { Repeat, Search } from 'lucide-react'
import { useMemo, useState } from 'react'

import Button from '@/components/ui/Button'
import StakeModal from '@/pages/staking/components/StakeModal'
import ValidatorRow from '@/pages/staking/components/ValidatorRow'
import { DISPLAY_DENOM } from '@/chains/secret4'
import { useBalances } from '@/hooks/useBalances'
import { usePermit } from '@/hooks/usePermit'
import { useStaking } from '@/hooks/useStaking'
import { useStakingActions } from '@/hooks/useStakingActions'
import { formatDisplayAmount } from '@/lib/format'
import type { Validator } from '@/lib/staking'
import { useWallet } from '@/store/wallet'

/**
 * Staking, and Secret's own auto-restake.
 *
 * Auto-restake changes are staged rather than sent one at a time: each is a
 * message, and batching them into one transaction means one signature and one
 * fee no matter how many validators are involved.
 */
export default function Staking() {
  const address = useWallet((state) => state.address)
  const { permit } = usePermit()
  const balances = useBalances(permit)
  const staking = useStaking()
  const actions = useStakingActions(staking.refresh)

  const [query, setQuery] = useState('')
  const [managing, setManaging] = useState<Validator | undefined>()
  /** Toggled but not yet sent, as validator address → desired state. */
  const [staged, setStaged] = useState<Map<string, boolean>>(new Map())

  const validators = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const matching = needle
      ? staking.validators.filter((v) => v.moniker.toLowerCase().includes(needle))
      : staking.validators

    // Validators you already stake with come first; the rest keep their
    // voting-power order.
    return [...matching].sort((a, b) => {
      const aMine = staking.delegations.has(a.address) ? 1 : 0
      const bMine = staking.delegations.has(b.address) ? 1 : 0
      return bMine - aMine
    })
  }, [staking.validators, staking.delegations, query])

  const rewardValidators = [...staking.rewards.keys()]

  const toggleRestake = (validatorAddress: string) => {
    const current = staged.get(validatorAddress) ?? staking.restaking.has(validatorAddress)
    const next = new Map(staged)
    // Toggling back to what the chain already says is not a change to send.
    if (!current === staking.restaking.has(validatorAddress)) next.delete(validatorAddress)
    else next.set(validatorAddress, !current)
    setStaged(next)
  }

  const applyRestake = async () => {
    await actions.setAutoRestake(
      [...staged].map(([validatorAddress, enabled]) => ({ validatorAddress, enabled }))
    )
    setStaged(new Map())
  }

  if (!address) {
    return <p className="text-base text-text-muted">Connect a wallet to stake {DISPLAY_DENOM}.</p>
  }

  return (
    <div className="mx-auto flex max-w-[860px] flex-col gap-8">
      <h1 className="text-display">Staking</h1>

      {/*
        One surface with hairlines, not three floating cards. Three identical
        rounded boxes side by side is the shape a layout takes when nothing has
        decided which figure matters; a divided row says these belong together
        and lets the numbers carry the weight.
      */}
      <div className="grid divide-y divide-border overflow-hidden rounded-card bg-surface-1 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <Stat label="Staked" value={`${formatDisplayAmount(staking.totalStaked)} ${DISPLAY_DENOM}`} />
        <Stat label="Available" value={`${formatDisplayAmount(balances.native ?? '0')} ${DISPLAY_DENOM}`} />
        <div className="p-5">
          <p className="text-label text-text-muted">Rewards</p>
          <p className="mt-1.5 text-headline tabular-nums text-positive">
            {formatDisplayAmount(staking.totalRewards)}{' '}
            <span className="text-title text-text-muted">{DISPLAY_DENOM}</span>
          </p>
          {rewardValidators.length > 0 ? (
            <Button
              variant="soft"
              shape="control"
              size="sm"
              className="mt-3"
              loading={actions.state.kind === 'sending'}
              onClick={() => void actions.claimRewards(rewardValidators)}
            >
              Claim from {rewardValidators.length}
            </Button>
          ) : null}
        </div>
      </div>

      {staking.unbondings.length > 0 ? (
        <section className="rounded-card bg-surface-1 p-4">
          <h2 className="text-base font-medium">Unstaking</h2>
          <ul className="mt-2 flex flex-col gap-1">
            {staking.unbondings.map((u, index) => (
              <li key={`${u.validatorAddress}-${index}`} className="flex justify-between gap-4 text-sm">
                <span className="text-text-muted">
                  {staking.validators.find((v) => v.address === u.validatorAddress)?.moniker ??
                    u.validatorAddress}
                </span>
                <span>
                  {formatDisplayAmount(u.amount)} {DISPLAY_DENOM} · available{' '}
                  {u.completesAt.toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/*
        Staged auto-restake changes ride in one transaction. Sending them one
        toggle at a time would cost a signature and a fee each.
      */}
      {staged.size > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-accent-container px-4 py-3">
          <p className="flex items-center gap-2 text-base text-accent">
            <Repeat size={16} aria-hidden />
            {staged.size} auto-restake {staged.size === 1 ? 'change' : 'changes'} ready
          </p>
          <span className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setStaged(new Map())}>
              Discard
            </Button>
            <Button
              variant="primary"
              shape="control"
              size="sm"
              loading={actions.state.kind === 'sending'}
              onClick={() => void applyRestake()}
            >
              Apply in one transaction
            </Button>
          </span>
        </div>
      ) : null}

      {actions.state.kind === 'failed' ? (
        <p className="break-address rounded-card bg-surface-1 p-4 text-base text-negative" role="alert">
          {actions.state.message}
        </p>
      ) : null}

      <section className="flex flex-col gap-4">
        <div className="flex items-center gap-3 rounded-control bg-surface px-4 py-2.5">
          <Search size={16} aria-hidden className="shrink-0 text-text-muted" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search validators"
            className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-text-faint"
          />
        </div>

        {staking.loading && validators.length === 0 ? (
          <div className="flex flex-col gap-2" aria-busy>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-card bg-surface-1" />
            ))}
          </div>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-card bg-surface-1">
            {validators.map((validator) => (
              <ValidatorRow
                key={validator.address}
                validator={validator}
                delegation={staking.delegations.get(validator.address)}
                reward={staking.rewards.get(validator.address)}
                restaking={staged.get(validator.address) ?? staking.restaking.has(validator.address)}
                restakeChanged={staged.has(validator.address)}
                restakeThreshold={staking.restakeThreshold}
                onToggleRestake={() => toggleRestake(validator.address)}
                onManage={() => setManaging(validator)}
              />
            ))}
          </ul>
        )}

        {staking.error ? (
          <p className="text-base text-text-muted" role="alert">
            Validators could not be read: {staking.error}
          </p>
        ) : null}
      </section>

      {managing ? (
        <StakeModal
          validator={managing}
          validators={staking.validators}
          delegation={staking.delegations.get(managing.address)}
          available={balances.native}
          unbondingSeconds={staking.unbondingSeconds}
          state={actions.state}
          onClose={() => {
            setManaging(undefined)
            actions.reset()
          }}
          onDelegate={(amount) => void actions.delegate(managing.address, amount)}
          onUndelegate={(amount) => void actions.undelegate(managing.address, amount)}
          onRedelegate={(to, amount) => void actions.redelegate(managing.address, to, amount)}
        />
      ) : null}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  const [amount, denom] = value.split(' ')
  return (
    <div className="p-5">
      <p className="text-label text-text-muted">{label}</p>
      <p className="mt-1.5 text-headline tabular-nums">
        {amount} <span className="text-title text-text-muted">{denom}</span>
      </p>
    </div>
  )
}

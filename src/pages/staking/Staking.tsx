import { ChevronDown, Coins, Repeat, Search } from 'lucide-react'
import { useMemo, useState } from 'react'

import Button from '@/components/ui/Button'
import EmptyState from '@/components/ui/EmptyState'
import { PickerDialog } from '@/components/ui/Picker'
import StakeModal from '@/pages/staking/components/StakeModal'
import ValidatorRow from '@/pages/staking/components/ValidatorRow'
import { DISPLAY_DENOM } from '@/chains/secret4'
import { useBalances } from '@/hooks/useBalances'
import { usePermit } from '@/hooks/usePermit'
import { useStaking } from '@/hooks/useStaking'
import { useStakingActions } from '@/hooks/useStakingActions'
import { useValidatorImages } from '@/hooks/useValidatorImages'
import UnbondingBranches, { type UnbondingRow } from '@/components/wallet/UnbondingBranches'
import { useWalletData } from '@/hooks/walletData'
import { cn } from '@/lib/cn'
import { formatDisplayAmount, formatFiat, fromBaseUnits, shortenAddress } from '@/lib/format'
import { shareOfBonded, type Validator } from '@/lib/staking'
import { useConnectDialog } from '@/store/connectDialog'
import { useSettings } from '@/store/settings'
import { useWallet } from '@/store/wallet'
import { permitAuth } from '@/lib/snip20'

/**
 * Staking, and Secret's own auto-restake.
 *
 * Auto-restake changes are staged rather than sent one at a time: each is a
 * message, and batching them into one transaction means one signature and one
 * fee no matter how many validators are involved.
 */
export default function Staking() {
  const openConnect = useConnectDialog((state) => state.show)
  const address = useWallet((state) => state.address)
  const currency = useSettings((state) => state.currency)
  const { permit } = usePermit()
  const balances = useBalances(permit && permitAuth(permit))
  const staking = useStaking()
  // Delegating, undelegating and claiming all move SCRT out of or into the
  // spendable balance, not just the staking totals — both need to hear about it.
  const actions = useStakingActions(() => {
    staking.refresh()
    balances.refresh()
  })

  // Read once for the whole shell, so this page and the wallet cannot disagree
  // about what is in Shade's queue.
  const { derivative } = useWalletData()

  const images = useValidatorImages(staking.validators)

  /*
   * Both queues as one list. They end in the same place — SCRT in this account
   * — and someone asking "what have I got coming back" is not asking it once
   * per protocol. Shade's rows carry a tag, because the wait is not the same
   * shape: a redemption waits for the contract's next batch before the chain's
   * clock even starts.
   *
   * Shade's matured-but-unclaimed SCRT is deliberately left out. It is not
   * unstaking any more, it is sitting there waiting to be collected, and the
   * button that collects it is on the wallet screen where it belongs.
   */
  const unstaking = useMemo(() => {
    const rows: UnbondingRow[] = staking.unbondings.map((u) => ({
      amount: u.amount,
      at: u.completesAt,
      label:
        staking.validators.find((v) => v.address === u.validatorAddress)?.moniker ??
        shortenAddress(u.validatorAddress, 12, 5, { reveal: true })
    }))

    for (const entry of derivative.unbondings) {
      if (entry.mature) continue
      rows.push({ amount: entry.amount, at: entry.at, label: 'Shade Protocol', tag: 'stkd-SCRT' })
    }

    if (BigInt(derivative.nextBatch.amount) > 0n) {
      rows.push({
        amount: derivative.nextBatch.amount,
        at: derivative.nextBatch.at,
        label: 'Shade Protocol — next batch',
        tag: 'stkd-SCRT'
      })
    }

    let total = 0n
    for (const row of rows) {
      try {
        total += BigInt(row.amount)
      } catch {
        // Reported on the row itself; a total is not the place to fail.
      }
    }

    return { rows, total: total.toString() }
  }, [staking.unbondings, staking.validators, derivative.unbondings, derivative.nextBatch])

  const [query, setQuery] = useState('')
  /*
   * The breakdown starts closed, like the queues in the wallet do. What this
   * section owes you at a glance is that something is coming back and how much;
   * the dates are for when you ask.
   */
  const [unstakingOpen, setUnstakingOpen] = useState(false)
  const [managing, setManaging] = useState<Validator | undefined>()
  /** The "Stake" picker, for choosing who without assuming for them. */
  const [pickingValidator, setPickingValidator] = useState(false)
  /** Toggled but not yet sent, as validator address → desired state. */
  const [staged, setStaged] = useState<Map<string, boolean>>(new Map())

  /*
   * Two lists rather than one reordered list: "yours" is a small, fixed set
   * worth always seeing in full, and burying it at the top of a searchable
   * list it also belongs to (the ask was to keep it in both) reads as one
   * list with a sort order, not two different questions — "what do I already
   * have" and "who else could I stake with."
   */
  const myValidators = useMemo(
    () =>
      staking.validators
        .filter((v) => staking.delegations.has(v.address))
        .sort((a, b) => {
          const av = BigInt(staking.delegations.get(a.address)?.amount ?? '0')
          const bv = BigInt(staking.delegations.get(b.address)?.amount ?? '0')
          return bv > av ? 1 : bv < av ? -1 : 0
        }),
    [staking.validators, staking.delegations]
  )

  const allValidators = useMemo(() => {
    const needle = query.trim().toLowerCase()
    // Already sorted by voting power — `queryValidators` does that once, on
    // the chain's own numbers, so there is nothing to re-sort here.
    return needle
      ? staking.validators.filter((v) => v.moniker.toLowerCase().includes(needle))
      : staking.validators
  }, [staking.validators, query])

  // Only the bonded set counts toward a share of the network: a jailed or
  // unbonding validator's `tokens` figure is not a voting-power figure
  // anything else is comparable against.
  const totalBonded = useMemo(
    () =>
      staking.validators
        .filter((v) => v.status === 'BOND_STATUS_BONDED')
        .reduce((sum, v) => sum + BigInt(v.tokens), 0n),
    [staking.validators]
  )

  const rewardValidators = [...staking.rewards.keys()]

  /*
   * Reused rather than fetched again: `useBalances` already prices native SCRT
   * for the wallet screen, and dividing its two figures back out gives the
   * same per-token price without a second CoinGecko round trip for a number
   * this page only wants to show once.
   */
  const scrtPrice =
    balances.native && BigInt(balances.native) > 0n && balances.nativeFiat !== undefined
      ? balances.nativeFiat / Number(fromBaseUnits(balances.native))
      : undefined
  const stakedFiat =
    scrtPrice !== undefined ? Number(fromBaseUnits(staking.totalStaked)) * scrtPrice : undefined

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
    return (
      <EmptyState
        icon={Coins}
        title={`Stake ${DISPLAY_DENOM}`}
        description="Delegate to a validator, earn rewards, and let the chain compound them for you without signing again."
        action={<Button onClick={openConnect}>Connect a wallet</Button>}
      />
    )
  }

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-10">
      <h1 className="text-display">Staking</h1>

      {/*
        Three figures side by side, with nothing framing or dividing them —
        no hairlines, no boxed card. The heading above and the lists below
        already carry their own rhythm of spacing; a bar of rules around this
        one row was structure nothing else on the page needed.
      */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
        <div>
          <p className="text-label text-text-muted">Staked</p>
          <p className="mt-1.5 text-headline tabular-nums">
            {formatDisplayAmount(staking.totalStaked)}{' '}
            <span className="text-title text-text-muted">{DISPLAY_DENOM}</span>
          </p>
          <p className="mt-0.5 text-label text-text-faint">{formatFiat(stakedFiat, currency)}</p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-label text-text-muted">Available</p>
            <p className="mt-1.5 text-headline tabular-nums">
              {formatDisplayAmount(balances.native ?? '0')}{' '}
              <span className="text-title text-text-muted">{DISPLAY_DENOM}</span>
            </p>
            <p className="mt-0.5 text-label text-text-faint">{formatFiat(balances.nativeFiat, currency)}</p>
          </div>

          <div className="relative flex shrink-0 flex-col items-center">
            {staking.apr !== undefined ? (
              <span className="absolute -top-3 z-10 whitespace-nowrap rounded-pill bg-accent-strong px-2.5 py-0.5 text-[0.6875rem] font-semibold text-[var(--color-accent-text)]">
                {(staking.apr * 100).toFixed(2)}% APR
              </span>
            ) : null}
            <Button
              variant="soft"
              shape="control"
              disabled={staking.validators.length === 0}
              onClick={() => setPickingValidator(true)}
            >
              Stake
            </Button>
          </div>
        </div>

        <div>
          <p className="text-label text-text-muted">Claimable rewards</p>
          <p className="mt-1.5 text-headline tabular-nums text-positive">
            {formatDisplayAmount(staking.totalRewards)}{' '}
            <span className="text-title text-text-muted">{DISPLAY_DENOM}</span>
          </p>
          {rewardValidators.length > 0 ? (
            <Button
              variant="soft"
              shape="control"
              size="sm"
              className="mt-2"
              loading={actions.state.kind === 'sending'}
              onClick={() => void actions.claimRewards(rewardValidators)}
            >
              Claim from {rewardValidators.length}
            </Button>
          ) : (
            <p className="mt-0.5 text-label text-text-faint">Nothing to claim yet</p>
          )}
        </div>
      </div>

      {/*
        Who "Stake" actually means — picked, not assumed. Bonded only: staking
        fresh SCRT with something already jailed or unbonding is not a choice
        this picker should be handing anyone by default.
      */}
      <PickerDialog
        open={pickingValidator}
        onClose={() => setPickingValidator(false)}
        label="Validator"
        options={staking.validators
          .filter((v) => v.status === 'BOND_STATUS_BONDED')
          .map((v) => {
            const share = shareOfBonded(v, totalBonded)
            return {
              id: v.address,
              label: v.moniker,
              detail: `${(v.commission * 100).toFixed(1)}% commission`,
              image: v.identity ? images.get(v.identity) : undefined,
              meta: share !== undefined ? `${(share * 100).toFixed(1)}%` : undefined
            }
          })}
        onChange={(id) => {
          const validator = staking.validators.find((v) => v.address === id)
          if (validator) setManaging(validator)
        }}
      />

      {/*
        Everything on its way back to SCRT, from both places it can be coming
        from: undelegations in the staking module and redemptions inside Shade's
        derivative contract. They are different waits — one is the chain's 21
        days, the other is a batch and then the chain's 21 days, and only the
        second can be skipped by selling instead — so the rows say which, and
        the total says what it all adds up to.

        The rows themselves are the wallet's, from `UnbondingBranches`: the same
        undelegations are listed there, and two components drawing one list is
        how two screens end up disagreeing about when the money arrives.
      */}
      {unstaking.rows.length > 0 ? (
        <section className="card p-4">
          <button
            type="button"
            onClick={() => setUnstakingOpen((open) => !open)}
            aria-expanded={unstakingOpen}
            className="flex w-full items-center gap-3 text-left"
          >
            <h2 className="text-base font-medium">Unstaking</h2>
            <span className="flex-1 text-label text-text-faint">
              {unstaking.rows.length} {unstaking.rows.length === 1 ? 'position' : 'positions'}
            </span>
            <span className="tabular-nums text-base font-medium">
              {formatDisplayAmount(unstaking.total)} {DISPLAY_DENOM}
            </span>
            <ChevronDown
              size={16}
              aria-hidden
              className={cn(
                'shrink-0 text-text-muted transition-transform duration-[var(--duration-short)] ease-[var(--ease-standard)]',
                unstakingOpen && 'rotate-180'
              )}
            />
          </button>

          {unstakingOpen ? (
            <UnbondingBranches seconds={staking.unbondingSeconds} rows={unstaking.rows} />
          ) : null}
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
        <p className="break-address card p-4 text-base text-negative" role="alert">
          {actions.state.message}
        </p>
      ) : null}

      {/*
        A separate section for what you already hold, not just a sort order
        within the full list — "what do I have" and "who else is out there"
        are different questions, and the second one still lists everyone in
        the first, since narrowing it down to strangers would make it useless
        for moving a delegation you already have.
      */}
      {myValidators.length > 0 ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-title">Your validators</h2>
          <div className="flex flex-col">
            <div className="flex items-center gap-4 border-b border-border px-2 pb-2 text-label text-text-faint">
              <span className="min-w-0 flex-1">Validator</span>
              <span className="hidden w-24 shrink-0 text-right sm:block sm:w-32">Staked</span>
              <span className="hidden w-10 shrink-0 sm:block" aria-hidden />
            </div>
            <ul>
              {myValidators.map((validator) => (
                <ValidatorRow
                  key={validator.address}
                  validator={validator}
                  delegation={staking.delegations.get(validator.address)}
                  reward={staking.rewards.get(validator.address)}
                  image={validator.identity ? images.get(validator.identity) : undefined}
                  networkShare={shareOfBonded(validator, totalBonded)}
                  column="staked"
                  restaking={staged.get(validator.address) ?? staking.restaking.has(validator.address)}
                  restakeChanged={staged.has(validator.address)}
                  restakeThreshold={staking.restakeThreshold}
                  onToggleRestake={() => toggleRestake(validator.address)}
                  onManage={() => setManaging(validator)}
                />
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex items-baseline gap-2.5">
            <h2 className="text-title">All validators</h2>
            <span className="text-label text-text-faint">{allValidators.length} bonded</span>
          </div>
          <div className="flex w-full items-center gap-2.5 rounded-control border border-border bg-surface px-3 py-2 sm:w-64">
            <Search size={16} aria-hidden className="shrink-0 text-text-muted" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search validators"
              className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-text-faint"
            />
          </div>
        </div>

        {staking.loading && allValidators.length === 0 ? (
          <div className="flex flex-col gap-2" aria-busy>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-control bg-surface" />
            ))}
          </div>
        ) : (
          /*
            An open list rather than a bordered card — the same change made to
            the wallet's token list, for the same reason: the page already has
            the row to itself, and a box around it was drawing a second edge
            nothing needed.
          */
          <div className="flex flex-col">
            <div className="flex items-center gap-4 border-b border-border px-2 pb-2 text-label text-text-faint">
              <span className="min-w-0 flex-1">Validator</span>
              <span className="hidden w-24 shrink-0 text-right sm:block sm:w-32">Voting Power</span>
              <span className="hidden w-10 shrink-0 sm:block" aria-hidden />
            </div>

            <ul>
              {allValidators.map((validator) => (
                <ValidatorRow
                  key={validator.address}
                  validator={validator}
                  delegation={staking.delegations.get(validator.address)}
                  reward={staking.rewards.get(validator.address)}
                  image={validator.identity ? images.get(validator.identity) : undefined}
                  networkShare={shareOfBonded(validator, totalBonded)}
                  column="votingPower"
                  restaking={staged.get(validator.address) ?? staking.restaking.has(validator.address)}
                  restakeChanged={staged.has(validator.address)}
                  restakeThreshold={staking.restakeThreshold}
                  onToggleRestake={() => toggleRestake(validator.address)}
                  onManage={() => setManaging(validator)}
                />
              ))}
            </ul>
          </div>
        )}

        {staking.error ? (
          <p className="px-2 text-base text-text-muted" role="alert">
            Validators could not be read: {staking.error}
          </p>
        ) : null}
      </section>

      {managing ? (
        <StakeModal
          validator={managing}
          validators={staking.validators}
          delegation={staking.delegations.get(managing.address)}
          image={managing.identity ? images.get(managing.identity) : undefined}
          images={images}
          networkShare={shareOfBonded(managing, totalBonded)}
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

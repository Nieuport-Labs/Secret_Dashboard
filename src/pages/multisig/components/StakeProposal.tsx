import { ChevronDown } from 'lucide-react'
import { useMemo, useState } from 'react'

import { PickerDialog } from '@/components/ui/Picker'
import StakeModal from '@/pages/staking/components/StakeModal'
import { DECIMALS, DISPLAY_DENOM } from '@/chains/secret4'
import { useAccountStaking } from '@/hooks/useAccountStaking'
import { useBalances } from '@/hooks/useBalances'
import { useValidatorImages } from '@/hooks/useValidatorImages'
import { formatAmount, fromBaseUnits } from '@/lib/format'
import * as compose from '@/lib/multisig/compose'
import type { MultisigConfig } from '@/lib/multisig/config'
import type { DeclaredMsg } from '@/lib/multisig/messages'
import { shareOfBonded, type Validator } from '@/lib/staking'

/**
 * Staking for a multisig, through the dialog the staking screen already uses.
 *
 * Deliberately not a form of its own. Delegating, undelegating and moving a
 * delegation are one decision taken in one place everywhere else in this app,
 * and a second set of fields asking the same three questions in a different
 * order would be a second thing to keep right — and a second thing for
 * somebody who already knows this dialog to have to learn.
 *
 * What differs is only what the button does at the end. Nothing is sent here:
 * the validator and the amount become the proposal's message, the composer
 * shows it back through the same card the other members will read it in, and
 * the signing round does the rest. So the button says what it does rather than
 * promising a transaction that will not happen for hours.
 *
 * The figures it works from are the *account's* — its delegations, its
 * spendable SCRT — not the connected wallet's. A dialog showing the member's
 * own stake here would be quietly answering a question nobody asked.
 */

/** Stable across renders: a fresh array would restart the balance read forever. */
const NO_CONTRACTS: string[] = []

/**
 * The chain's unbonding period, for the dialog's "this takes N days" line.
 *
 * Hard-coded rather than read, unlike on the staking screen: this is one
 * sentence of context beside a dialog that sends nothing, and the proposal it
 * composes is checked against the chain in full before anybody signs it.
 */
const UNBONDING_SECONDS = 21 * 24 * 60 * 60

export type StakeKind = 'stake' | 'unstake' | 'redelegate'

const INITIAL_MODE = {
  stake: 'delegate',
  unstake: 'undelegate',
  redelegate: 'redelegate'
} as const

export default function StakeProposal({
  config,
  kind,
  onMessages,
  onSuggestTitle
}: {
  config: MultisigConfig
  kind: StakeKind
  onMessages: (messages: DeclaredMsg[]) => void
  onSuggestTitle: (title: string) => void
}) {
  const { validators, delegations, loading } = useAccountStaking(config.address)
  const images = useValidatorImages(validators)
  const balances = useBalances(undefined, config.address, NO_CONTRACTS)

  const [picking, setPicking] = useState(false)
  const [managing, setManaging] = useState<Validator | undefined>()
  /** What the last pass through the dialog composed, in words. */
  const [chosen, setChosen] = useState<string>()

  const totalBonded = useMemo(
    () =>
      validators
        .filter((entry) => entry.status === 'BOND_STATUS_BONDED')
        .reduce((sum, entry) => sum + BigInt(entry.tokens), 0n),
    [validators]
  )

  const staked = useMemo(
    () => [...delegations.values()].reduce((sum, entry) => sum + BigInt(entry.amount), 0n),
    [delegations]
  )

  /*
   * Who can be picked. Unstaking and moving can only touch what is actually
   * staked, so those list the account's own delegations rather than every
   * validator on the chain — offering the other six hundred would be offering
   * six hundred transactions the chain refuses.
   */
  const choices =
    kind === 'stake'
      ? validators.filter((entry) => entry.status === 'BOND_STATUS_BONDED')
      : validators.filter((entry) => delegations.has(entry.address))

  const settle = (message: DeclaredMsg, title: string) => {
    onMessages([message])
    onSuggestTitle(title)
    setChosen(title)
    setManaging(undefined)
  }

  const delegate = (validator: Validator, base: string) => {
    const amount = fromBaseUnits(base)
    settle(
      compose.stake({ delegator: config.address, validator: validator.address, amount }),
      `Stake ${amount} ${DISPLAY_DENOM} with ${validator.moniker}`
    )
  }

  const undelegate = (validator: Validator, base: string) => {
    const amount = fromBaseUnits(base)
    settle(
      compose.unstake({ delegator: config.address, validator: validator.address, amount }),
      `Unstake ${amount} ${DISPLAY_DENOM} from ${validator.moniker}`
    )
  }

  const redelegate = (validator: Validator, to: string, base: string) => {
    const amount = fromBaseUnits(base)
    const target = validators.find((entry) => entry.address === to)?.moniker ?? 'another validator'
    settle(
      compose.redelegate({ delegator: config.address, from: validator.address, to, amount }),
      `Move ${amount} ${DISPLAY_DENOM} from ${validator.moniker} to ${target}`
    )
  }

  if (loading && validators.length === 0) {
    return <p className="text-base text-text-muted">Reading the validator set…</p>
  }

  if (kind !== 'stake' && choices.length === 0) {
    return (
      <p className="rounded-card border border-border p-4 text-base text-text-muted">
        This account has nothing staked, so there is nothing to {kind === 'unstake' ? 'unstake' : 'move'}.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={() => setPicking(true)}
        className="state-layer flex items-center gap-3 rounded-control border border-border bg-surface px-3 py-2.5 text-left"
      >
        <span className={chosen ? 'min-w-0 flex-1 truncate text-base' : 'min-w-0 flex-1 text-base text-text-faint'}>
          {chosen ?? (kind === 'stake' ? 'Choose a validator' : 'Choose which delegation')}
        </span>
        <ChevronDown size={16} aria-hidden className="shrink-0 text-text-muted" />
      </button>

      <p className="text-label text-text-faint">
        {kind === 'stake'
          ? `This account holds ${formatAmount(balances.native ?? '0', { decimals: DECIMALS, reveal: true })} ${DISPLAY_DENOM} it could stake.`
          : `This account has ${formatAmount(staked.toString(), { decimals: DECIMALS, reveal: true })} ${DISPLAY_DENOM} staked with ${choices.length} ${choices.length === 1 ? 'validator' : 'validators'}.`}
        {chosen ? ' Pick again to change it.' : ''}
      </p>

      <PickerDialog
        open={picking}
        onClose={() => setPicking(false)}
        label="Validator"
        options={choices.map((entry) => {
          const share = shareOfBonded(entry, totalBonded)
          const delegated = delegations.get(entry.address)
          return {
            id: entry.address,
            label: entry.moniker,
            detail: `${(entry.commission * 100).toFixed(1)}% commission`,
            image: entry.identity ? images.get(entry.identity) : undefined,
            meta: delegated
              ? `${formatAmount(delegated.amount, { decimals: DECIMALS, reveal: true })} ${DISPLAY_DENOM}`
              : share !== undefined
                ? `${(share * 100).toFixed(1)}%`
                : undefined
          }
        })}
        value={managing?.address}
        onChange={(id) => setManaging(validators.find((entry) => entry.address === id))}
      />

      {managing ? (
        <StakeModal
          validator={managing}
          validators={validators}
          delegation={delegations.get(managing.address)}
          image={managing.identity ? images.get(managing.identity) : undefined}
          images={images}
          networkShare={shareOfBonded(managing, totalBonded)}
          available={balances.native}
          unbondingSeconds={UNBONDING_SECONDS}
          initialMode={INITIAL_MODE[kind]}
          submitLabel="Use this"
          /* Nothing is sent from here, so there is no sending, no failure and
             no transaction hash — the composer's own button carries all three. */
          state={{ kind: 'idle' }}
          onClose={() => setManaging(undefined)}
          onDelegate={(amount) => delegate(managing, amount)}
          onUndelegate={(amount) => undelegate(managing, amount)}
          onRedelegate={(to, amount) => redelegate(managing, to, amount)}
        />
      ) : null}
    </div>
  )
}

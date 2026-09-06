import { ExternalLink } from 'lucide-react'
import { useState } from 'react'

import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { DISPLAY_DENOM, explorerTxUrl } from '@/chains/secret4'
import type { ActionState } from '@/hooks/useStakingActions'
import { formatAmount, fromBaseUnits, toBaseUnits } from '@/lib/format'
import { cn } from '@/lib/cn'
import type { Delegation, Validator } from '@/lib/staking'

type Mode = 'delegate' | 'undelegate' | 'redelegate'

interface Props {
  validator: Validator
  validators: Validator[]
  delegation?: Delegation
  /** Native SCRT, in base units. */
  available?: string
  unbondingSeconds: number
  state: ActionState
  onClose: () => void
  onDelegate: (amount: string) => void
  onUndelegate: (amount: string) => void
  onRedelegate: (toValidator: string, amount: string) => void
}

const MODES: Array<{ value: Mode; label: string }> = [
  { value: 'delegate', label: 'Stake' },
  { value: 'undelegate', label: 'Unstake' },
  { value: 'redelegate', label: 'Move' }
]

export default function StakeModal({
  validator,
  validators,
  delegation,
  available,
  unbondingSeconds,
  state,
  onClose,
  onDelegate,
  onUndelegate,
  onRedelegate
}: Props) {
  const [mode, setMode] = useState<Mode>(delegation ? 'undelegate' : 'delegate')
  const [amount, setAmount] = useState('')
  const [destination, setDestination] = useState(
    validators.find((v) => v.address !== validator.address)?.address ?? ''
  )

  const staked = delegation?.amount ?? '0'
  const max = mode === 'delegate' ? (available ?? '0') : staked

  let baseUnits = '0'
  let amountError: string | undefined
  try {
    baseUnits = amount ? toBaseUnits(amount) : '0'
    if (BigInt(baseUnits) > BigInt(max)) amountError = 'More than you have here.'
  } catch (error) {
    amountError = error instanceof Error ? error.message : 'Not a number.'
  }

  const days = Math.round(unbondingSeconds / 86_400)

  const submit = () => {
    if (mode === 'delegate') onDelegate(baseUnits)
    else if (mode === 'undelegate') onUndelegate(baseUnits)
    else onRedelegate(destination, baseUnits)
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={validator.moniker}
      description={`${(validator.commission * 100).toFixed(1)}% commission`}
    >
      {state.kind === 'done' ? (
        <div className="flex flex-col gap-4">
          <p className="text-base">Sent.</p>
          <a
            className="inline-flex items-center gap-1.5 text-base text-accent underline underline-offset-4"
            href={explorerTxUrl(state.hash)}
            target="_blank"
            rel="noreferrer noopener"
          >
            View transaction
            <ExternalLink size={14} aria-hidden />
          </a>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      ) : (
        <>
          <div className="flex gap-2">
            {MODES.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setMode(option.value)}
                disabled={option.value !== 'delegate' && staked === '0'}
                className={cn(
                  'state-layer flex-1 rounded-control px-3 py-2 text-base font-medium',
                  mode === option.value ? 'bg-accent-container text-accent' : 'bg-surface',
                  option.value !== 'delegate' && staked === '0' && 'cursor-not-allowed opacity-40'
                )}
              >
                {option.label}
              </button>
            ))}
          </div>

          {mode === 'redelegate' ? (
            <label className="flex flex-col gap-2">
              <span className="text-base font-medium">To</span>
              <select
                value={destination}
                onChange={(event) => setDestination(event.target.value)}
                className="rounded-control border border-border bg-surface px-3 py-2.5 text-base outline-none"
              >
                {validators
                  .filter((v) => v.address !== validator.address)
                  .map((v) => (
                    <option key={v.address} value={v.address}>
                      {v.moniker} — {(v.commission * 100).toFixed(1)}%
                    </option>
                  ))}
              </select>
            </label>
          ) : null}

          <label className="flex flex-col gap-2">
            <span className="flex items-center justify-between text-base font-medium">
              Amount
              <button
                type="button"
                onClick={() => setAmount(fromBaseUnits(max))}
                className="state-layer rounded-control px-2 py-0.5 text-sm text-text-muted"
              >
                {mode === 'delegate' ? 'Available' : 'Staked'} {formatAmount(max)}
              </button>
            </span>
            <div className="flex items-center gap-2 rounded-control border border-border bg-surface px-3 py-2.5">
              <input
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0.0"
                className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-text-faint"
              />
              <span className="shrink-0 text-base text-text-muted">{DISPLAY_DENOM}</span>
            </div>
            {amountError ? (
              <span className="text-base text-negative" role="alert">
                {amountError}
              </span>
            ) : null}
          </label>

          {/*
            The unbonding period is the single most surprising thing about
            staking, and it is read from the chain rather than assumed. Moving
            between validators skips it entirely, which is worth saying here
            rather than leaving someone to unstake and wait for no reason.
          */}
          {mode === 'undelegate' ? (
            <p className="text-sm text-text-muted">
              Unstaking takes {days} days, during which the amount earns nothing and cannot be moved. To
              change validator without waiting, use Move instead.
            </p>
          ) : null}
          {mode === 'redelegate' ? (
            <p className="text-sm text-text-muted">
              Moving takes effect immediately and keeps earning. The same amount cannot be moved again until
              the {days}-day period passes.
            </p>
          ) : null}

          {state.kind === 'failed' ? (
            <p className="break-address text-base text-negative" role="alert">
              {state.message}
            </p>
          ) : null}

          <Button
            variant="primary"
            block
            loading={state.kind === 'sending'}
            disabled={Boolean(amountError) || BigInt(baseUnits || '0') === 0n}
            onClick={submit}
          >
            {MODES.find((m) => m.value === mode)?.label}
          </Button>
        </>
      )}
    </Modal>
  )
}

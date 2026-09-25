import { ChevronDown, ExternalLink, Globe } from 'lucide-react'
import { useState } from 'react'

import AmountField from '@/components/ui/AmountField'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { PickerDialog } from '@/components/ui/Picker'
import ValidatorAvatar from '@/pages/staking/components/ValidatorAvatar'
import { hostnameOf, socialIcon, withScheme } from '@/pages/staking/components/validatorSocial'
import { DECIMALS, DISPLAY_DENOM, explorerTxUrl } from '@/chains/secret4'
import type { ActionState } from '@/hooks/useStakingActions'
import { useValidatorProfile } from '@/hooks/useValidatorProfile'
import { formatAmount, toBaseUnits } from '@/lib/format'
import { cn } from '@/lib/cn'
import type { Delegation, Validator } from '@/lib/staking'
import { SSCRT_ADDRESS, tokenByAddress, tokenImageUrl } from '@/tokens/registry'

type Mode = 'delegate' | 'undelegate' | 'redelegate'
type Source = 'scrt' | 'sscrt'

interface Props {
  validator: Validator
  validators: Validator[]
  delegation?: Delegation
  /** From Keybase, when this validator published an identity and it resolved. */
  image?: string
  /** Avatars for the other validators, for the Move destination picker. */
  images?: Map<string, string>
  /** This validator's share of everything bonded on the chain, as a fraction. */
  networkShare?: number
  /** Native SCRT, in base units. */
  available?: string
  /**
   * sSCRT, in base units, when staking out of it is offered: unwrapped and
   * staked in one transaction. Left out where only public SCRT can stake — a
   * multisig proposal, say.
   */
  sscrtAvailable?: string
  unbondingSeconds: number
  state: ActionState
  /** Which tab opens. Defaults to unstaking when there is something staked. */
  initialMode?: Mode
  /**
   * What the button says, when pressing it does not send the transaction.
   *
   * A multisig cannot stake by pressing a button — it stakes by a transaction
   * a threshold of members signs — so the same dialog composes a proposal
   * there, and has to say so rather than promising something it will not do.
   */
  submitLabel?: string
  onClose: () => void
  onDelegate: (amount: string, fromSscrt: boolean) => void
  onUndelegate: (amount: string) => void
  onRedelegate: (toValidator: string, amount: string) => void
}

const sscrtToken = tokenByAddress(SSCRT_ADDRESS)
const sscrtImage = sscrtToken ? tokenImageUrl(sscrtToken) : undefined

const MODES: Array<{ value: Mode; label: string }> = [
  { value: 'delegate', label: 'Stake' },
  { value: 'undelegate', label: 'Unstake' },
  { value: 'redelegate', label: 'Move' }
]

export default function StakeModal({
  validator,
  validators,
  delegation,
  image,
  images,
  networkShare,
  available,
  sscrtAvailable,
  unbondingSeconds,
  state,
  initialMode,
  submitLabel,
  onClose,
  onDelegate,
  onUndelegate,
  onRedelegate
}: Props) {
  // Whatever the row's own avatar fetch already warmed the cache with (see
  // `useValidatorProfile`) renders instantly; this only does its own network
  // work the first time this particular identity is asked about.
  const profile = useValidatorProfile(validator.identity)

  const [mode, setMode] = useState<Mode>(initialMode ?? (delegation ? 'undelegate' : 'delegate'))
  const [amount, setAmount] = useState('')
  const [destination, setDestination] = useState(
    validators.find((v) => v.address !== validator.address)?.address ?? ''
  )
  const [pickingDestination, setPickingDestination] = useState(false)
  const destinationValidator = validators.find((v) => v.address === destination)

  // What a stake is paid from. sSCRT is only offered when there is some.
  const [source, setSource] = useState<Source>('scrt')
  const offerSscrt = sscrtAvailable !== undefined && BigInt(sscrtAvailable) > 0n
  const fromSscrt = mode === 'delegate' && offerSscrt && source === 'sscrt'

  const staked = delegation?.amount ?? '0'
  const max = mode === 'delegate' ? ((fromSscrt ? sscrtAvailable : available) ?? '0') : staked

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
    if (mode === 'delegate') onDelegate(baseUnits, fromSscrt)
    else if (mode === 'undelegate') onUndelegate(baseUnits)
    else onRedelegate(destination, baseUnits)
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={validator.moniker}
      description={`${(validator.commission * 100).toFixed(1)}% commission${
        networkShare !== undefined ? ` · ${(networkShare * 100).toFixed(2)}% voting power` : ''
      }`}
      icon={<ValidatorAvatar address={validator.address} moniker={validator.moniker} image={image} size={36} />}
    >
      {/*
        The operator's own words and links, when Keybase or the chain itself
        has them — everything here is a public claim the validator made, the
        same as what Keplr's validator page draws on. Neither is guaranteed to
        exist: `details` is a free-text field nobody is required to fill in,
        and a social link needs a Keybase identity that resolves at all.
      */}
      {validator.details || validator.website || (profile?.socials.length ?? 0) > 0 ? (
        <div className="flex flex-col gap-3 border-b border-border pb-4">
          {validator.details ? (
            <p className="line-clamp-4 text-sm leading-relaxed text-text-muted">{validator.details}</p>
          ) : null}

          {validator.website || (profile?.socials.length ?? 0) > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {validator.website ? (
                <a
                  href={withScheme(validator.website)}
                  target="_blank"
                  rel="noreferrer noopener"
                  title={validator.website}
                  className="state-layer flex items-center gap-1.5 rounded-control px-2 py-1 text-sm text-text-muted"
                >
                  <Globe size={15} aria-hidden />
                  {hostnameOf(validator.website)}
                </a>
              ) : null}

              {profile?.socials.map((social) => (
                <a
                  key={social.url}
                  href={social.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  title={social.url}
                  aria-label={`${validator.moniker} on ${social.type}`}
                  className="state-layer flex size-8 items-center justify-center rounded-pill text-text-muted"
                >
                  {socialIcon(social.type)}
                </a>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

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
            <div className="flex flex-col gap-2">
              <span className="text-base font-medium">To</span>
              {/*
                A searchable dialog rather than a native `<select>`: a
                moniker starting with an emoji — several validators on
                secret-4 do this — renders inside a native dropdown at
                whatever oversized size the OS gives emoji in a list box,
                which on some platforms is most of the screen. This is the
                same picker the "Stake" button up top uses.
              */}
              <button
                type="button"
                onClick={() => setPickingDestination(true)}
                className="state-layer flex items-center gap-2.5 rounded-control border border-border bg-surface px-3 py-2.5 text-left"
              >
                {destinationValidator ? (
                  <ValidatorAvatar
                    address={destinationValidator.address}
                    moniker={destinationValidator.moniker}
                    image={images?.get(destinationValidator.identity ?? '')}
                    size={24}
                  />
                ) : null}
                <span className="min-w-0 flex-1 truncate text-base">
                  {destinationValidator
                    ? `${destinationValidator.moniker} — ${(destinationValidator.commission * 100).toFixed(1)}%`
                    : 'Choose a validator'}
                </span>
                <ChevronDown size={16} aria-hidden className="shrink-0 text-text-muted" />
              </button>

              <PickerDialog
                open={pickingDestination}
                onClose={() => setPickingDestination(false)}
                label="Validator"
                options={validators
                  .filter((v) => v.address !== validator.address)
                  .map((v) => ({
                    id: v.address,
                    label: v.moniker,
                    detail: `${(v.commission * 100).toFixed(1)}% commission`,
                    image: v.identity ? images?.get(v.identity) : undefined
                  }))}
                value={destination}
                onChange={setDestination}
              />
            </div>
          ) : null}

          {/*
            The same amount field as Send and Wrap, slider included. Staking
            takes public SCRT; sSCRT is offered beside it and unwrapped in the
            same transaction, so it costs no extra step or signature.
          */}
          <AmountField
            amount={amount}
            onAmount={setAmount}
            symbol={fromSscrt ? 'sSCRT' : DISPLAY_DENOM}
            image={fromSscrt ? sscrtImage : '/img/secret-mark.svg'}
            available={max}
            availableLabel={mode === 'delegate' ? 'Available' : 'Staked'}
            decimals={DECIMALS}
            error={amountError}
            options={
              mode === 'delegate' && offerSscrt
                ? [
                    {
                      id: 'scrt',
                      label: DISPLAY_DENOM,
                      detail: `Available ${formatAmount(available ?? '0')} · public`,
                      image: '/img/secret-mark.svg'
                    },
                    {
                      id: 'sscrt',
                      label: 'sSCRT',
                      detail: `Available ${formatAmount(sscrtAvailable ?? '0')} · unwrapped and staked in one transaction`,
                      image: sscrtImage
                    }
                  ]
                : undefined
            }
            optionsLabel="Stake from"
            value={source}
            onSelect={(id) => {
              setSource(id as Source)
              setAmount('')
            }}
          />

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
            {submitLabel ?? MODES.find((m) => m.value === mode)?.label}
          </Button>
        </>
      )}
    </Modal>
  )
}

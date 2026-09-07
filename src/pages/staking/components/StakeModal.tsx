import { ChevronDown, ExternalLink, Github, Globe, Linkedin, Twitter } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { PickerDialog } from '@/components/ui/Picker'
import ValidatorAvatar from '@/pages/staking/components/ValidatorAvatar'
import { DISPLAY_DENOM, explorerTxUrl } from '@/chains/secret4'
import type { ActionState } from '@/hooks/useStakingActions'
import { useValidatorProfile } from '@/hooks/useValidatorProfile'
import { formatAmount, fromBaseUnits, toBaseUnits } from '@/lib/format'
import { cn } from '@/lib/cn'
import type { Delegation, Validator } from '@/lib/staking'
import type { SocialLink } from '@/lib/validatorImage'

type Mode = 'delegate' | 'undelegate' | 'redelegate'

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
  unbondingSeconds: number
  state: ActionState
  onClose: () => void
  onDelegate: (amount: string) => void
  onUndelegate: (amount: string) => void
  onRedelegate: (toValidator: string, amount: string) => void
}

/** A URL for display: whatever a validator operator typed into `website` is
 *  not guaranteed to include a scheme, and the raw string is too long to sit
 *  next to an icon anyway. */
function hostnameOf(url: string): string {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname
  } catch {
    return url
  }
}

function withScheme(url: string): string {
  return url.startsWith('http') ? url : `https://${url}`
}

/** Keybase's own vocabulary for a proof type, not this app's — passed through
 *  for anything it doesn't have a specific icon for rather than hidden. */
function socialIcon(type: SocialLink['type']): ReactNode {
  switch (type) {
    case 'twitter':
      return <Twitter size={15} aria-hidden />
    case 'github':
      return <Github size={15} aria-hidden />
    case 'linkedin':
      return <Linkedin size={15} aria-hidden />
    default:
      return <Globe size={15} aria-hidden />
  }
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
  image,
  images,
  networkShare,
  available,
  unbondingSeconds,
  state,
  onClose,
  onDelegate,
  onUndelegate,
  onRedelegate
}: Props) {
  // Whatever the row's own avatar fetch already warmed the cache with (see
  // `useValidatorProfile`) renders instantly; this only does its own network
  // work the first time this particular identity is asked about.
  const profile = useValidatorProfile(validator.identity)

  const [mode, setMode] = useState<Mode>(delegation ? 'undelegate' : 'delegate')
  const [amount, setAmount] = useState('')
  const [destination, setDestination] = useState(
    validators.find((v) => v.address !== validator.address)?.address ?? ''
  )
  const [pickingDestination, setPickingDestination] = useState(false)
  const destinationValidator = validators.find((v) => v.address === destination)

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

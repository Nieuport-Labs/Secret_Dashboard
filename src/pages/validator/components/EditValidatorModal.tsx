import { useEffect, useState } from 'react'

import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { explorerTxUrl } from '@/chains/secret4'
import type { useValidatorAdmin } from '@/hooks/useValidatorAdmin'
import type { ValidatorDetail } from '@/lib/validator'

interface Props {
  open: boolean
  onClose: () => void
  detail: ValidatorDetail
  admin: ReturnType<typeof useValidatorAdmin>
}

/** A day, which is the chain's cooldown between two commission changes. */
const RATE_COOLDOWN_MS = 24 * 60 * 60 * 1000

/**
 * Editing the public face of a validator, and its commission.
 *
 * The commission field carries two rules the chain enforces and would
 * otherwise reject the whole transaction over: the rate may not exceed the
 * maximum fixed when the validator was created, may not move by more than the
 * maximum change rate in one step, and may not move twice within a day. Each is
 * checked here so the answer arrives before a signature rather than after a fee.
 */
export default function EditValidatorModal({ open, onClose, detail, admin }: Props) {
  const [moniker, setMoniker] = useState(detail.moniker)
  const [identity, setIdentity] = useState(detail.identity ?? '')
  const [website, setWebsite] = useState(detail.website ?? '')
  const [details, setDetails] = useState(detail.details ?? '')
  const [rate, setRate] = useState((detail.commission * 100).toFixed(2))

  // Re-seed from the chain each time it opens, so a cancelled edit does not
  // linger as the starting point of the next one.
  useEffect(() => {
    if (!open) return
    setMoniker(detail.moniker)
    setIdentity(detail.identity ?? '')
    setWebsite(detail.website ?? '')
    setDetails(detail.details ?? '')
    setRate((detail.commission * 100).toFixed(2))
    admin.reset()
    // `admin` is rebuilt every render; only reopening should re-seed the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, detail])

  const percent = Number(rate)
  const changed = Math.abs(percent / 100 - detail.commission) > 1e-9
  const changedAt = detail.commissionUpdatedAt
  const cooling = changedAt ? Date.now() - changedAt.getTime() < RATE_COOLDOWN_MS : false

  const rateError = (() => {
    if (!changed) return undefined
    if (!Number.isFinite(percent) || percent < 0) return 'Give the rate as a percentage.'
    if (percent / 100 > detail.maxRate)
      return `This validator's ceiling is ${(detail.maxRate * 100).toFixed(0)}%.`
    if (Math.abs(percent / 100 - detail.commission) > detail.maxChangeRate + 1e-9)
      return `The rate may move by at most ${(detail.maxChangeRate * 100).toFixed(2)} points a day.`
    if (percent === 0)
      return 'A rate of exactly zero cannot be sent — the chain reads it as "leave unchanged".'
    if (cooling && changedAt)
      return `Already changed on ${changedAt.toLocaleDateString()}. The chain allows one change a day.`
    return undefined
  })()

  const sending = admin.state.kind === 'sending'

  const submit = async () => {
    await admin.edit(
      { moniker, identity, website, details },
      // Left out entirely when unchanged: resending the current rate still
      // spends the one change the chain allows for the day.
      changed ? percent / 100 : undefined
    )
  }

  return (
    <Modal open={open} onClose={onClose} title="Edit validator" description={detail.moniker}>
      <div className="flex flex-col gap-4">
        <Field label="Moniker" value={moniker} onChange={setMoniker} />
        <Field
          label="Keybase identity"
          value={identity}
          onChange={setIdentity}
          hint="The 16-character key fingerprint your picture is looked up by."
        />
        <Field label="Website" value={website} onChange={setWebsite} />
        <Field label="Details" value={details} onChange={setDetails} multiline />
        <Field
          label="Commission rate (%)"
          value={rate}
          onChange={setRate}
          error={rateError}
          hint={`Currently ${(detail.commission * 100).toFixed(2)}%, ceiling ${(detail.maxRate * 100).toFixed(0)}%.`}
        />

        {admin.state.kind === 'failed' ? (
          <p className="break-address text-base text-negative" role="alert">
            {admin.state.message}
          </p>
        ) : null}
        {admin.state.kind === 'done' ? (
          <p className="text-base text-text-muted">
            Sent.{' '}
            <a
              href={explorerTxUrl(admin.state.hash)}
              target="_blank"
              rel="noreferrer"
              className="text-accent"
            >
              View the transaction
            </a>
          </p>
        ) : null}

        <Button
          block
          loading={sending}
          disabled={Boolean(rateError) || moniker.trim() === ''}
          onClick={() => void submit()}
        >
          Save changes
        </Button>
      </div>
    </Modal>
  )
}

interface FieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  hint?: string
  error?: string
  multiline?: boolean
}

function Field({ label, value, onChange, hint, error, multiline }: FieldProps) {
  const className =
    'w-full rounded-control border border-border bg-surface px-3 py-2 text-base outline-none focus:border-border-strong'

  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-label text-text-muted">{label}</span>
      {multiline ? (
        <textarea
          rows={3}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={className}
        />
      ) : (
        <input value={value} onChange={(event) => onChange(event.target.value)} className={className} />
      )}
      {error ? (
        <span className="text-label text-negative" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="text-label text-text-faint">{hint}</span>
      ) : null}
    </label>
  )
}

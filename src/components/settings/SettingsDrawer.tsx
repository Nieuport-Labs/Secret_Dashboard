import { CheckCircle2, Info } from 'lucide-react'

import Drawer from '@/components/ui/Drawer'
import { DISPLAY_DENOM } from '@/chains/secret4'
import { availableFee, type FeeGrant } from '@/lib/feegrant-sdk'
import { formatAmount, shortenAddress } from '@/lib/format'
import { cn } from '@/lib/cn'
import { useFeePayer } from '@/store/feePayer'
import { useSettings, type FeeMode, type Theme } from '@/store/settings'

interface Props {
  open: boolean
  onClose: () => void
}

/**
 * The three fee modes, worded the way the SDK actually behaves.
 *
 * "Auto" does not mean "when I am short". A grant is a standing offer, made so
 * it would be used, so Auto spends one whenever it covers the fee even if the
 * wallet could pay. There is deliberately no "only when low" mode, because that
 * would quietly decline something someone offered.
 */
const FEE_MODES: Array<{ value: FeeMode; label: string; detail: string }> = [
  {
    value: 'auto',
    label: 'Auto',
    detail: 'Use the best grant whenever one covers the fee. Falls back to this wallet when none can.'
  },
  {
    value: 'select',
    label: 'Choose',
    detail: 'Always use one particular grant, falling back to this wallet when it cannot pay.'
  },
  {
    value: 'off',
    label: 'This wallet',
    detail: 'Never spend a grant, even when one is usable.'
  }
]

export default function SettingsDrawer({ open, onClose }: Props) {
  const settings = useSettings()
  const grants = useFeePayer((state) => state.grants)

  return (
    <Drawer open={open} onClose={onClose} title="Settings">
      <section className="flex flex-col gap-3">
        <h3 className="text-base font-semibold">Transaction fees</h3>

        <div className="flex flex-col gap-2">
          {FEE_MODES.map((mode) => (
            <label
              key={mode.value}
              className={cn(
                'state-layer flex cursor-pointer flex-col gap-1 rounded-control p-3',
                settings.feeMode === mode.value ? 'bg-accent-container' : 'bg-surface'
              )}
            >
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name="fee-mode"
                  value={mode.value}
                  checked={settings.feeMode === mode.value}
                  onChange={() => settings.set('feeMode', mode.value)}
                  className="sr-only"
                />
                {settings.feeMode === mode.value ? (
                  <CheckCircle2 size={16} aria-hidden className="text-accent" />
                ) : (
                  <span aria-hidden className="size-4 rounded-pill border border-border" />
                )}
                <span
                  className={cn('text-base font-medium', settings.feeMode === mode.value && 'text-accent')}
                >
                  {mode.label}
                </span>
              </span>
              <span className="pl-6 text-sm text-text-muted">{mode.detail}</span>
            </label>
          ))}
        </div>

        {settings.feeMode === 'select' ? <GranterPicker grants={grants} /> : null}

        <p className="flex items-start gap-2 text-sm text-text-faint">
          <Info size={14} aria-hidden className="mt-0.5 shrink-0" />
          The chain checks a grant again when the transaction runs, so one can be revoked or drained between
          choosing it and using it. This wallet pays when that happens.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-base font-semibold">Appearance</h3>
        <div className="flex gap-2">
          {(['dark', 'light'] as Theme[]).map((theme) => (
            <button
              key={theme}
              type="button"
              onClick={() => settings.set('theme', theme)}
              className={cn(
                'state-layer flex-1 rounded-control px-4 py-2.5 text-base font-medium capitalize',
                settings.theme === theme ? 'bg-accent-container text-accent' : 'bg-surface'
              )}
            >
              {theme}
            </button>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-base font-semibold">Notifications</h3>
        <label className="state-layer flex cursor-pointer items-start gap-3 rounded-control bg-surface p-3">
          <input
            type="checkbox"
            checked={settings.notificationsEnabled}
            onChange={(event) => settings.set('notificationsEnabled', event.target.checked)}
            className="mt-1 size-4 shrink-0 accent-[var(--color-accent)]"
          />
          <span>
            <span className="block text-base font-medium">Private push notifications</span>
            <span className="block text-sm text-text-muted">
              Tells you when a private token arrives, without polling. Turning this off falls back to checking
              periodically, which still works.
            </span>
          </span>
        </label>
      </section>
    </Drawer>
  )
}

function GranterPicker({ grants }: { grants: FeeGrant[] }) {
  const feeGranter = useSettings((state) => state.feeGranter)
  const set = useSettings((state) => state.set)

  if (grants.length === 0) {
    return (
      <p className="rounded-control bg-surface p-3 text-sm text-text-muted">
        Nobody is currently covering fees for this address. An empty list is not proof none exists — it can
        also mean the grant list could not be read.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {grants.map((grant) => {
        const left = availableFee(grant)
        return (
          <label
            key={grant.granter}
            className={cn(
              'state-layer flex cursor-pointer items-center justify-between gap-3 rounded-control p-3',
              feeGranter === grant.granter ? 'bg-accent-container' : 'bg-surface'
            )}
          >
            <input
              type="radio"
              name="fee-granter"
              checked={feeGranter === grant.granter}
              onChange={() => set('feeGranter', grant.granter)}
              className="sr-only"
            />
            <span className="min-w-0">
              <span className="block truncate text-base">{shortenAddress(grant.granter)}</span>
              <span className="block text-sm text-text-faint">
                {grant.kind === 'periodic' ? 'refills' : 'one-time'}
              </span>
            </span>
            <span className="shrink-0 text-base">
              {left === undefined ? 'uncapped' : `${formatAmount(left.toString())} ${DISPLAY_DENOM}`}
            </span>
          </label>
        )
      })}
    </div>
  )
}

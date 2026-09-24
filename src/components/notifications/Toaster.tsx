import { AlertCircle, CheckCircle2, Clock, ExternalLink, Fuel, Loader2, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import Button from '@/components/ui/Button'
import { SHADE_SWAP_URL } from '@/lib/autoRefill'
import { cn } from '@/lib/cn'
import { useNotifications, type Toast } from '@/store/notifications'
import { useTransactions, type TrackedTx } from '@/store/transactions'

/**
 * The toast stack (Figma 34:688, 36:79, 36:88, 36:3).
 *
 * Bottom-right on desktop, full width above the nav bar on a phone. Announced
 * politely: an arriving token is worth telling a screen reader about, but not
 * worth interrupting whatever it was reading.
 *
 * Transactions in flight share the stack, above the toasts — see
 * `lib/txProgress.ts`.
 */
export default function Toaster() {
  const toasts = useNotifications((state) => state.toasts)
  const dismiss = useNotifications((state) => state.dismiss)
  const transactions = useTransactions((state) => state.transactions)
  const dismissTx = useTransactions((state) => state.dismiss)

  if (toasts.length === 0 && transactions.length === 0) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 bottom-24 z-40 flex flex-col items-end gap-2.5 lg:inset-x-auto lg:bottom-6 lg:right-6 lg:w-[360px]"
    >
      {transactions.map((tx) => (
        <TxCard key={tx.id} tx={tx} onDismiss={() => dismissTx(tx.id)} />
      ))}
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
      ))}
    </div>
  )
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const navigate = useNavigate()

  return (
    <div className="glass-panel pointer-events-auto w-full rounded-card p-4 motion-safe:animate-[toast-in_var(--duration-medium)_var(--ease-emphasised)]">
      {toast.kind === 'error' ? (
        <div className="flex items-start gap-2.5">
          <AlertCircle size={16} aria-hidden className="mt-px shrink-0 text-negative" />
          <p className="text-base">{toast.message}</p>
        </div>
      ) : toast.kind === 'gas-empty' ? (
        <>
          <div className="flex items-start gap-2.5">
            <Fuel size={16} aria-hidden className="mt-0.5 shrink-0 text-accent" />
            <p className="text-base">{toast.message}</p>
          </div>
          <div className="mt-3 flex gap-2.5">
            <a
              href={SHADE_SWAP_URL}
              target="_blank"
              rel="noreferrer noopener"
              onClick={onDismiss}
              className="state-layer inline-flex flex-1 items-center justify-center gap-1.5 rounded-control bg-accent-strong px-4 py-2 text-base font-medium text-[var(--color-accent-text)]"
            >
              Get SCRT/sSCRT
              <ExternalLink size={14} aria-hidden />
            </a>
            <Button variant="secondary" shape="control" onClick={onDismiss}>
              Dismiss
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <span className="text-title text-accent">{headline(toast)}</span>
            <span className="flex items-center gap-1.5 whitespace-nowrap">
              <span className="text-title">{toast.amount}</span>
              <span className="text-sm text-text-muted">{toast.symbol}</span>
              {toast.image ? <img src={toast.image} alt="" className="size-4 rounded-pill" /> : null}
            </span>
          </div>

          {/*
            A public token on Secret is visible to anyone. Offering to wrap it
            at the moment it lands is the only point where the user knows what
            it is and why they have it.
          */}
          {toast.kind === 'received-public' ? (
            <>
              <p className="mt-2 text-base">Do you want to wrap it?</p>
              <div className="mt-3 flex gap-2.5">
                <Button
                  variant="primary"
                  shape="control"
                  className="flex-1"
                  onClick={() => {
                    onDismiss()
                    const token = toast.wrapContract ? `&token=${toast.wrapContract}` : ''
                    navigate(`/wallet?panel=wrap${token}`)
                  }}
                >
                  Wrap
                </Button>
                <Button variant="secondary" shape="control" onClick={onDismiss}>
                  Dismiss
                </Button>
              </div>
            </>
          ) : (
            <button
              type="button"
              onClick={onDismiss}
              className="state-layer mt-2 rounded-control px-2 py-1 text-sm text-text-muted"
            >
              Dismiss
            </button>
          )}
        </>
      )}
    </div>
  )
}

/**
 * One transaction, updated in place as it moves along.
 *
 * The steps are the real ones — the wallet prompt, then each chain it lands
 * on — not a timer dressed up as progress, so a step that takes a while simply
 * stays lit. An IBC transfer is followed to the far chain, and the card ends
 * on a link to where it arrived rather than to where it left.
 */
function TxCard({ tx, onDismiss }: { tx: TrackedTx; onDismiss: () => void }) {
  const failed = tx.status === 'failed'
  const settled = tx.status === 'done'

  return (
    <div className="glass-panel pointer-events-auto w-full rounded-card p-4 motion-safe:animate-[toast-in_var(--duration-medium)_var(--ease-emphasised)]">
      <div className="flex items-start gap-2.5">
        {failed ? (
          <AlertCircle size={16} aria-hidden className="mt-0.5 shrink-0 text-negative" />
        ) : settled ? (
          <CheckCircle2 size={16} aria-hidden className="mt-0.5 shrink-0 text-positive" />
        ) : tx.status === 'stalled' ? (
          <Clock size={16} aria-hidden className="mt-0.5 shrink-0 text-text-muted" />
        ) : (
          <Loader2 size={16} aria-hidden className="mt-0.5 shrink-0 animate-spin text-accent" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-base font-medium">{tx.label}</p>
          {tx.detail ? <p className="truncate text-sm text-text-faint">{tx.detail}</p> : null}
          <p className={cn('mt-1 text-sm', failed ? 'break-address text-negative' : 'text-text-muted')}>
            {tx.text}
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="state-layer -mr-1 -mt-1 shrink-0 rounded-control p-1 text-text-muted"
        >
          <X size={14} aria-hidden />
        </button>
      </div>

      <ol
        className="mt-3 grid gap-1.5"
        style={{ gridTemplateColumns: `repeat(${tx.steps.length}, minmax(0, 1fr))` }}
        aria-label="Progress"
      >
        {tx.steps.map((step, index) => {
          const behind = index < tx.step
          const current = index === tx.step && !settled
          return (
            <li key={`${step}-${index}`} className="flex min-w-0 flex-col gap-1">
              <span
                className={cn(
                  'h-1 rounded-pill transition-colors duration-[var(--duration-medium)]',
                  behind
                    ? 'bg-accent'
                    : current && failed
                      ? 'bg-negative'
                      : current && tx.status === 'running'
                        ? 'bg-accent motion-safe:animate-pulse'
                        : 'bg-surface-3'
                )}
              />
              <span
                className={cn(
                  'truncate text-label',
                  behind || current ? 'text-text-muted' : 'text-text-faint'
                )}
                aria-current={current ? 'step' : undefined}
              >
                {step}
              </span>
            </li>
          )
        })}
      </ol>

      {tx.links.length > 0 ? (
        <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
          {tx.links.map((link) => (
            <a
              key={link.url}
              href={link.url}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 text-sm text-accent underline underline-offset-4"
            >
              {link.label}
              <ExternalLink size={12} aria-hidden />
            </a>
          ))}
        </p>
      ) : null}
    </div>
  )
}

function headline(toast: Toast): string {
  switch (toast.kind) {
    case 'wrapped':
      return 'You just wrapped'
    case 'bridged':
      return 'You just bridged'
    default:
      return 'You just received'
  }
}

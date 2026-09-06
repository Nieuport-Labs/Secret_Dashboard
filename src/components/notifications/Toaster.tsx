import { AlertCircle } from 'lucide-react'

import Button from '@/components/ui/Button'
import { useNotifications, type Toast } from '@/store/notifications'

/**
 * The toast stack (Figma 34:688, 36:79, 36:88, 36:3).
 *
 * Bottom-right on desktop, full width above the nav bar on a phone. Announced
 * politely: an arriving token is worth telling a screen reader about, but not
 * worth interrupting whatever it was reading.
 */
export default function Toaster() {
  const toasts = useNotifications((state) => state.toasts)
  const dismiss = useNotifications((state) => state.dismiss)

  if (toasts.length === 0) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 bottom-24 z-40 flex flex-col items-end gap-2.5 lg:inset-x-auto lg:bottom-6 lg:right-6"
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
      ))}
    </div>
  )
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  return (
    <div className="pointer-events-auto w-full max-w-[360px] rounded-card bg-surface-3 p-5 motion-safe:animate-[toast-in_var(--duration-medium)_var(--ease-emphasised)]">
      {toast.kind === 'error' ? (
        <div className="flex items-start gap-2.5">
          <AlertCircle size={18} aria-hidden className="mt-0.5 shrink-0 text-negative" />
          <p className="text-base">{toast.message}</p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <span className="text-lg font-semibold text-accent">{headline(toast)}</span>
            <span className="flex items-center gap-1.5 whitespace-nowrap">
              <span className="text-lg font-semibold">{toast.amount}</span>
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
                <Button variant="primary" shape="control" className="flex-1" onClick={onDismiss}>
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

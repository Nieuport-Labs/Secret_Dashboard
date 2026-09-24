import { CheckCircle2, ExternalLink, Eye, Loader2, ShieldCheck } from 'lucide-react'
import { useEffect } from 'react'

import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import AssetAmount from '@/components/wallet/AssetAmount'
import { explorerTxUrl } from '@/chains/secret4'
import { cn } from '@/lib/cn'
import { formatAmount, shortenAddress } from '@/lib/format'
import { invoiceBaseUnits, type Invoice } from '@/lib/invoice'
import { useAssetBalance } from '@/hooks/useAssetBalance'
import { useWalletActions } from '@/hooks/useWalletActions'

interface Props {
  open: boolean
  onClose: () => void
  invoice: Invoice
  /** Called once the payment lands. */
  onPaid?: () => void
}

/**
 * Paying an invoice: a confirmation, not a form.
 *
 * Nothing here is editable. The link set the recipient, the asset and the
 * amount, and a form that let any of them be changed would turn "pay this
 * invoice" into "send something to someone" — the one mistake worth designing
 * out is paying a different amount than was asked for, or the wrong account.
 */
export default function PayInvoiceModal({ open, onClose, invoice, onPaid }: Props) {
  const actions = useWalletActions(() => {
    refresh()
    onPaid?.()
  })
  const { asset } = invoice
  const base = invoiceBaseUnits(invoice.amount, asset.decimals) ?? '0'

  // Reopening after a payment must not show the receipt as if it were pending.
  useEffect(() => {
    if (open) actions.reset()
    // Only when it opens; `actions` is rebuilt on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  /*
   * Only the one asset the invoice is in, read directly — see
   * `useAssetBalance`. Until it answers, or when it cannot (a private token
   * with no permit yet), the payment is still offered: the chain is the judge
   * of whether it is covered.
   */
  const { balance, refresh, signPermit, signing } = useAssetBalance(open ? asset : undefined)
  const held = balance.status === 'ok' ? balance.amount : undefined
  const short = held !== undefined && BigInt(held) < BigInt(base)

  const pay = () => {
    const summary = {
      label: `Pay ${invoice.amount} ${asset.symbol}`,
      detail: `to ${shortenAddress(invoice.to)}`
    }
    if (asset.private) void actions.sendToken(asset.id, invoice.to, base, summary)
    else void actions.sendNative(invoice.to, base, asset.id, summary)
  }

  return (
    <Modal open={open} onClose={onClose} title="Pay invoice">
      {actions.state.kind === 'done' ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 size={18} aria-hidden className="mt-0.5 shrink-0 text-positive" />
            <p className="text-base">Paid.</p>
          </div>
          <a
            className="inline-flex items-center gap-1.5 text-base text-accent underline underline-offset-4"
            href={explorerTxUrl(actions.state.hash)}
            target="_blank"
            rel="noreferrer noopener"
          >
            View transaction
            <ExternalLink size={14} aria-hidden />
          </a>
        </div>
      ) : (
        <>
          <div className="flex flex-col items-center gap-3 rounded-card border border-border bg-surface px-4 py-5 text-center">
            <span className="text-label text-text-muted">You&rsquo;re paying</span>
            <AssetAmount amount={invoice.amount} symbol={asset.symbol} image={asset.image} />
          </div>

          {/* The recipient is not repeated here: the pay page behind this dialog
              names them, with the address, and that is where it is checked. */}
          <dl className="-mt-2 flex flex-col gap-2 rounded-card border border-border bg-surface px-4 py-3 text-base">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-text-muted">Your balance</dt>
              <dd className={cn('flex items-center gap-1.5', short && 'text-negative')}>
                {balance.status === 'loading' ? (
                  <>
                    <Loader2 size={14} aria-hidden className="animate-spin text-text-faint" />
                    <span className="text-text-faint">Loading…</span>
                  </>
                ) : balance.status === 'ok' ? (
                  `${formatAmount(balance.amount, { decimals: asset.decimals })} ${asset.symbol}`
                ) : balance.status === 'needs-permit' ? (
                  /* A private balance is only readable with the query permit;
                     one signature, no transaction. */
                  <button
                    type="button"
                    onClick={() => void signPermit()}
                    disabled={signing}
                    className="text-accent underline underline-offset-4 disabled:opacity-50"
                  >
                    {signing ? 'Signing…' : 'Sign permit to show'}
                  </button>
                ) : (
                  <span className="text-text-faint" title={balance.message}>
                    Could not be read
                  </span>
                )}
              </dd>
            </div>
          </dl>

          <p className="flex items-start gap-2 text-label text-text-muted">
            {asset.private ? (
              <>
                <ShieldCheck size={14} aria-hidden className="mt-px shrink-0 text-accent" />A SNIP-20 transfer
                is encrypted. The chain records that you called the contract, not who was paid or how much.
              </>
            ) : (
              <>
                <Eye size={14} aria-hidden className="mt-px shrink-0" />
                {asset.symbol} moves through the bank module, so the amount and both addresses are public.
              </>
            )}
          </p>

          {actions.state.kind === 'failed' ? (
            <p className="break-address text-base text-negative" role="alert">
              {actions.state.message}
            </p>
          ) : null}

          <Button
            variant="primary"
            block
            size="lg"
            loading={actions.state.kind === 'sending'}
            disabled={short}
            onClick={pay}
          >
            {short ? `Not enough ${asset.symbol}` : `Pay ${invoice.amount} ${asset.symbol}`}
          </Button>
        </>
      )}
    </Modal>
  )
}

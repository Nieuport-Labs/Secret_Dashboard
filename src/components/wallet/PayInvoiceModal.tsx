import { ArrowDown, CheckCircle2, ChevronDown, ExternalLink, Eye, ShieldCheck } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { PickerDialog } from '@/components/ui/Picker'
import { explorerTxUrl } from '@/chains/secret4'
import { useAssetBalance } from '@/hooks/useAssetBalance'
import { useBalances } from '@/hooks/useBalances'
import { usePermit } from '@/hooks/usePermit'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'
import { formatAmount, shortenAddress } from '@/lib/format'
import { quoteInto, swappableTokens } from '@/lib/gasPurchase'
import { invoiceBaseUnits, type Invoice } from '@/lib/invoice'
import { paymentMessages, settlementToken, type PaySource } from '@/lib/invoicePayment'
import type { Quote } from '@/lib/shadeSwap'
import { permitAuth } from '@/lib/snip20'
import { sendTx } from '@/lib/sendTx'
import { canUnwrap, useSettings } from '@/store/settings'
import { useWallet } from '@/store/wallet'
import { privateSymbol, tokenByAddress, tokenImageUrl } from '@/tokens/registry'

interface Props {
  open: boolean
  onClose: () => void
  invoice: Invoice
  /** Called once the payment lands. */
  onPaid?: () => void
}

/** The invoice's own asset. Anything else is a token address. */
const DIRECT = 'direct'
/** A public invoice, paid from the private form of the same asset. */
const UNWRAP = 'unwrap'

type Status =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'done'; hash: string }
  | { kind: 'failed'; message: string }

type QuoteState =
  { kind: 'none' } | { kind: 'loading' } | { kind: 'ready'; quote: Quote } | { kind: 'unavailable' }

/**
 * Paying an invoice: a confirmation, not a form.
 *
 * Nothing about what is paid is editable. The link set the recipient, the
 * asset and the amount, and a form that let any of them be changed would turn
 * "pay this invoice" into "send something to someone" — the one mistake worth
 * designing out is paying a different amount than was asked for, or the wrong
 * account.
 *
 * What the payer spends is theirs to choose, though: the asset itself, or any
 * private token that can be swapped for it on ShadeSwap in the same
 * transaction (`lib/invoicePayment.ts`). The recipient gets the invoice's
 * amount of the invoice's asset either way.
 */
export default function PayInvoiceModal({ open, onClose, invoice, onPaid }: Props) {
  return (
    <Modal open={open} onClose={onClose} title="Pay invoice">
      {/* Mounts with the dialog, so a reopened one starts fresh and nothing is
          read while it is closed. */}
      <PayInvoice invoice={invoice} onPaid={onPaid} />
    </Modal>
  )
}

/** A long figure is set smaller on a phone rather than cut off with an ellipsis. */
function figureSize(amount: string): string {
  return amount.length > 8 ? 'text-[1.5rem] sm:text-[2rem]' : 'text-[2rem]'
}

function PayInvoice({ invoice, onPaid }: { invoice: Invoice; onPaid?: () => void }) {
  const client = useWallet((state) => state.client)
  const queryClient = useWallet((state) => state.queryClient)
  const address = useWallet((state) => state.address)
  const assetMode = useSettings((state) => state.assetMode)
  const { permit } = usePermit()

  const { asset } = invoice
  const amount = BigInt(invoiceBaseUnits(invoice.amount, asset.decimals) ?? '0')
  const token = settlementToken(asset)
  // Paying a public invoice any other way ends in an unwrap of `token`, which
  // easy mode allows for sSCRT only.
  const otherWays = Boolean(token) && (asset.private || canUnwrap(assetMode, token!))

  const [payWith, setPayWith] = useState<string>(DIRECT)
  const [picking, setPicking] = useState(false)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [swappable, setSwappable] = useState<string[]>([])
  const [quote, setQuote] = useState<QuoteState>({ kind: 'none' })

  /*
   * The invoice's own asset, read directly — see `useAssetBalance`. Until it
   * answers, or when it cannot (a private token with no permit yet), paying
   * with it is still offered: the chain is the judge of whether it is covered.
   */
  const direct = useAssetBalance(asset)

  useEffect(() => {
    if (!queryClient || !permit || !token || !otherWays) return
    let cancelled = false
    void swappableTokens(queryClient, permit, token)
      .then((tokens) => {
        if (!cancelled) setSwappable(tokens)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [queryClient, permit, token, otherWays])

  const contracts = useMemo(
    () => (token && otherWays ? [token, ...swappable] : []),
    [token, otherWays, swappable]
  )
  const balances = useBalances(
    permit && contracts.length > 0 ? permitAuth(permit) : undefined,
    undefined,
    contracts
  )

  const held = useMemo(() => {
    const map = new Map<string, bigint>()
    for (const row of balances.tokens) {
      if (row.outcome.status === 'ok' && BigInt(row.outcome.amount) > 0n) {
        map.set(row.token.address, BigInt(row.outcome.amount))
      }
    }
    return map
  }, [balances.tokens])

  const swapping = payWith !== DIRECT && payWith !== UNWRAP
  const payToken = swapping ? tokenByAddress(payWith) : undefined

  useEffect(() => {
    if (!swapping || !queryClient || !token) {
      setQuote({ kind: 'none' })
      return
    }
    setQuote({ kind: 'loading' })
    let cancelled = false
    void quoteInto(queryClient, payWith, token, amount)
      .then((found) => {
        if (!cancelled) setQuote(found ? { kind: 'ready', quote: found } : { kind: 'unavailable' })
      })
      .catch(() => {
        if (!cancelled) setQuote({ kind: 'unavailable' })
      })
    return () => {
      cancelled = true
    }
    // `amount` is fixed by the invoice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swapping, queryClient, payWith, token])

  const tokenInfo = token ? tokenByAddress(token) : undefined
  const directHeld = direct.balance.status === 'ok' ? BigInt(direct.balance.amount) : undefined

  const options = [
    {
      id: DIRECT,
      label: asset.symbol,
      detail:
        direct.balance.status === 'ok'
          ? `Balance ${formatAmount(direct.balance.amount, { decimals: asset.decimals })}`
          : direct.balance.status === 'loading'
            ? 'Loading…'
            : direct.balance.status === 'needs-permit'
              ? 'Private balance'
              : 'Balance could not be read',
      image: asset.image
    },
    ...(!asset.private && token && otherWays && held.has(token)
      ? [
          {
            id: UNWRAP,
            label: tokenInfo ? privateSymbol(tokenInfo) : token,
            detail: `Balance ${formatAmount(held.get(token)!.toString(), { decimals: asset.decimals })} · unwrapped`,
            image: tokenInfo ? tokenImageUrl(tokenInfo) : undefined
          }
        ]
      : []),
    ...swappable
      .filter((candidate) => held.has(candidate))
      .map((candidate) => {
        const info = tokenByAddress(candidate)
        return {
          id: candidate,
          label: info ? privateSymbol(info) : candidate,
          detail: `Balance ${formatAmount(held.get(candidate)!.toString(), {
            decimals: info?.decimals ?? 6
          })} · swapped on ShadeSwap`,
          image: info ? tokenImageUrl(info) : undefined
        }
      })
  ]
  const selected = options.find((option) => option.id === payWith) ?? options[0]
  const paySymbol = selected.label

  // Why the chosen way of paying cannot cover the invoice, if it cannot.
  let payError: string | undefined
  if (payWith === DIRECT && directHeld !== undefined && directHeld < amount)
    payError = `Not enough ${asset.symbol}.`
  if (payWith === UNWRAP && token && (held.get(token) ?? 0n) < amount) payError = `Not enough ${paySymbol}.`
  if (swapping) {
    if (quote.kind === 'unavailable') payError = 'ShadeSwap cannot fill this amount right now.'
    if (quote.kind === 'ready') {
      if (quote.quote.amountIn > (held.get(payWith) ?? 0n)) payError = `Not enough ${paySymbol}.`
    }
  }

  const ready =
    Boolean(client && queryClient && address) && !payError && (!swapping || quote.kind === 'ready')

  const pay = async () => {
    if (!client || !queryClient || !address || !ready) return
    const source: PaySource =
      payWith === DIRECT
        ? { kind: 'direct' }
        : payWith === UNWRAP
          ? { kind: 'unwrap' }
          : { kind: 'swap', token: payWith, quote: (quote as { kind: 'ready'; quote: Quote }).quote }

    setStatus({ kind: 'sending' })
    try {
      const plan = await paymentMessages(queryClient, address, invoice.to, asset, amount, source)
      const tx = await sendTx(client, plan.messages, plan.gasLimit, plan.msgTypes, {
        label: `Pay ${invoice.amount} ${asset.symbol}`,
        detail:
          payWith === DIRECT
            ? `to ${shortenAddress(invoice.to)}`
            : `with ${paySymbol}, to ${shortenAddress(invoice.to)}`
      })
      if (tx.code !== 0) {
        setStatus({ kind: 'failed', message: tx.rawLog || `The chain rejected it (code ${tx.code}).` })
        return
      }
      setStatus({ kind: 'done', hash: tx.transactionHash })
      direct.refresh()
      onPaid?.()
    } catch (error) {
      setStatus({ kind: 'failed', message: errorMessage(error) })
    }
  }

  if (status.kind === 'done') {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <CheckCircle2 size={18} aria-hidden className="mt-0.5 shrink-0 text-positive" />
          <p className="text-base">Paid.</p>
        </div>
        <a
          className="inline-flex items-center gap-1.5 text-base text-accent underline underline-offset-4"
          href={explorerTxUrl(status.hash)}
          target="_blank"
          rel="noreferrer noopener"
        >
          View transaction
          <ExternalLink size={14} aria-hidden />
        </a>
      </div>
    )
  }

  // What leaves the payer's wallet: the invoice amount itself, or — through a
  // swap — the quoted cost in the chosen token.
  const payDecimals = swapping ? (payToken?.decimals ?? 6) : asset.decimals
  const payAmount = !swapping
    ? invoice.amount
    : quote.kind === 'ready'
      ? formatAmount(quote.quote.amountIn.toString(), { decimals: payDecimals })
      : undefined

  const payBalance =
    payWith === DIRECT
      ? directHeld
      : payWith === UNWRAP
        ? token
          ? held.get(token)
          : undefined
        : held.get(payWith)

  return (
    <>
      {/*
        Laid out as a swap, the way the wrap panel is: what leaves the wallet on
        top, with the token picker beside it, and what the recipient gets
        underneath. Paying in the invoice's own asset, the two are simply the
        same figure.
      */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4">
          <span className="text-label text-text-muted">You pay</span>
          <div className="flex items-center gap-3">
            <span
              className={cn(
                'min-w-0 flex-1 truncate font-medium leading-tight tabular-nums',
                figureSize(payAmount ?? ''),
                payAmount === undefined && 'text-text-faint'
              )}
            >
              {payAmount ?? (quote.kind === 'loading' ? '…' : '—')}
            </span>
            <button
              type="button"
              onClick={() => setPicking(true)}
              aria-haspopup="dialog"
              aria-label={`Pay with ${selected.label}`}
              className="state-layer flex shrink-0 items-center gap-2 rounded-pill border border-border py-1.5 pl-1.5 pr-2.5"
            >
              {selected.image ? (
                <img src={selected.image} alt="" className="size-6 shrink-0 rounded-pill" />
              ) : null}
              <span className="text-base font-medium">{selected.label}</span>
              <ChevronDown size={14} aria-hidden className="text-text-muted" />
            </button>
          </div>
          <div className="flex items-center justify-between gap-3 text-label">
            {!permit ? (
              <button
                type="button"
                onClick={() => void direct.signPermit()}
                disabled={direct.signing}
                className="text-accent disabled:opacity-50"
              >
                {direct.signing ? 'Signing…' : 'Pay with another token'}
              </button>
            ) : (
              <span className="text-text-faint">{swapping ? 'Swapped on ShadeSwap' : ''}</span>
            )}
            {payBalance !== undefined ? (
              <span className="tabular-nums text-text-faint">
                Balance {formatAmount(payBalance.toString(), { decimals: payDecimals })}
              </span>
            ) : null}
          </div>
        </div>

        <span className="mx-auto flex size-8 items-center justify-center text-text-faint">
          <ArrowDown size={16} aria-hidden />
        </span>

        <div className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4">
          <span className="text-label text-text-muted">They receive</span>
          <div className="flex items-center gap-3">
            <span
              className={cn(
                'min-w-0 flex-1 truncate font-medium leading-tight tabular-nums',
                figureSize(invoice.amount)
              )}
            >
              {invoice.amount}
            </span>
            <span className="flex shrink-0 items-center gap-2 py-1.5 pr-2.5">
              {asset.image ? <img src={asset.image} alt="" className="size-6 shrink-0 rounded-pill" /> : null}
              <span className="text-base font-medium">{asset.symbol}</span>
            </span>
          </div>
          <div className="flex items-center justify-between gap-3 text-label text-text-faint">
            <span className="min-w-0 truncate">To {shortenAddress(invoice.to)}</span>
            <span className="flex shrink-0 items-center gap-1">
              {asset.private ? (
                <ShieldCheck size={12} aria-hidden className="text-accent" />
              ) : (
                <Eye size={12} aria-hidden />
              )}
              {asset.private ? 'Private' : 'Public'}
            </span>
          </div>
        </div>
      </div>

      <PickerDialog
        open={picking}
        onClose={() => setPicking(false)}
        label="Pay with"
        options={options}
        value={payWith}
        onChange={(id) => setPayWith(id)}
      />

      {payError ? (
        <span className="-mt-2 text-base text-negative" role="alert">
          {payError}
        </span>
      ) : null}

      {status.kind === 'failed' ? (
        <p className="break-address text-base text-negative" role="alert">
          {status.message}
        </p>
      ) : null}

      <Button
        variant="primary"
        block
        size="lg"
        loading={status.kind === 'sending'}
        disabled={!ready}
        onClick={() => void pay()}
      >
        {`Pay ${invoice.amount} ${asset.symbol}`}
      </Button>
    </>
  )
}

import { Check, ChevronDown, EyeOff, Share2 } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useEffect, useMemo, useState } from 'react'

import AmountHero from '@/components/ui/AmountHero'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import AssetAmount from '@/components/wallet/AssetAmount'
import { PickerDialog } from '@/components/ui/Picker'
import { DENOM } from '@/chains/secret4'
import { cn } from '@/lib/cn'
import { shortenAddress } from '@/lib/format'
import {
  invoiceAsset,
  invoiceAssets,
  invoiceBaseUnits,
  invoiceUri,
  invoiceUrl,
  type Invoice
} from '@/lib/invoice'
import { fetchPrices } from '@/lib/prices'
import { usePrivacy } from '@/store/privacy'
import { useSettings } from '@/store/settings'

interface Props {
  open: boolean
  onClose: () => void
  /** Returns to the dialog this was opened from — Receive, or the wallet choice. */
  onBack?: () => void
  /**
   * Who gets paid. For an invoice, the connected account; for a payment from
   * a phone, the profile it was started on.
   */
  address: string
  /**
   * `invoice` makes a link to hand to someone else. `phone` is the same form
   * turned round: the person on this page pays, from the wallet on their
   * phone, by scanning the payment URI — nothing is signed in this browser.
   */
  purpose?: 'invoice' | 'phone'
}

type Target = 'uri' | 'link'

/**
 * Creating an invoice, in two dialogs.
 *
 * The first looks like Send on purpose — an amount, first and largest, and the
 * asset under it — because it is the same question asked from the other side.
 * What it leaves out is the address: an invoice is always paid to the account
 * that is connected, so there is nothing to type and nothing to get wrong.
 *
 * The second is what gets handed over: the code, and a link to share. It is a
 * separate dialog rather than the first one changing underneath the user,
 * because at that point the invoice is made and the question is a different
 * one — not "what do I ask for" but "how do I send this".
 */
export default function InvoiceModal({ open, onClose, onBack, address, purpose = 'invoice' }: Props) {
  const phone = purpose === 'phone'
  const assets = useMemo(() => invoiceAssets(), [])

  const [assetId, setAssetId] = useState(DENOM)
  const [amount, setAmount] = useState('')
  const [picking, setPicking] = useState(false)
  const [invoice, setInvoice] = useState<Invoice | undefined>()

  // A fresh form every time it is opened; an invoice from last time showing
  // up again reads as if it was never sent.
  useEffect(() => {
    if (!open) return
    setAmount('')
    setInvoice(undefined)
  }, [open])

  const asset = invoiceAsset(assetId) ?? assets[0]

  /*
   * The asset's price, for the fiat view. Asked for here rather than taken
   * from the wallet's balances, because an invoice is usually for something
   * the account does not hold yet — and a held balance is the only thing the
   * wallet prices. The invoice itself is always in the token: a price moves,
   * and an invoice that meant a different amount by the time it was paid
   * would not be one.
   */
  const currency = useSettings((state) => state.currency)
  const [prices, setPrices] = useState<Map<string, number>>(new Map())
  useEffect(() => {
    if (!open || !asset.priceId || prices.has(`${asset.priceId}:${currency}`)) return
    let cancelled = false
    const id = asset.priceId
    fetchPrices([id], currency.toLowerCase())
      .then((result) => {
        const price = result.get(id)
        if (!cancelled && price !== undefined)
          setPrices((previous) => new Map(previous).set(`${id}:${currency}`, price))
      })
      .catch(() => {
        // No price is not an error here — the fiat view is simply not offered.
      })
    return () => {
      cancelled = true
    }
  }, [open, asset.priceId, currency, prices])
  const unitPrice = asset.priceId ? prices.get(`${asset.priceId}:${currency}`) : undefined
  const trimmed = amount.trim()
  const valid = invoiceBaseUnits(trimmed, asset.decimals) !== undefined
  const error = trimmed && !valid ? `Not an amount of ${asset.symbol}.` : undefined

  const options = assets.map((option) => ({
    id: option.id,
    label: option.symbol,
    detail: option.detail,
    image: option.image
  }))

  return (
    <>
      <Modal
        open={open && !invoice}
        onClose={onClose}
        onBack={onBack}
        title={phone ? 'Tip with QR code' : 'New invoice'}
      >
        <div className="flex flex-col gap-4 rounded-card border border-border bg-surface p-4">
          <span className="text-label text-text-muted">
            {phone ? 'You\u2019re sending' : 'You\u2019re requesting'}
          </span>
          <AmountHero
            amount={amount}
            onAmount={setAmount}
            symbol={asset.symbol}
            decimals={asset.decimals}
            unitPrice={unitPrice}
            currency={currency}
          />
        </div>

        <button
          type="button"
          onClick={() => setPicking(true)}
          aria-haspopup="dialog"
          className="state-layer -mt-2 flex items-center gap-3 rounded-card border border-border bg-surface px-4 py-3 text-left"
        >
          {asset.image ? <img src={asset.image} alt="" className="size-8 shrink-0 rounded-pill" /> : null}
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-base font-medium">{asset.symbol}</span>
            <span className="truncate text-label text-text-faint">{asset.detail}</span>
          </span>
          <ChevronDown size={16} aria-hidden className="shrink-0 text-text-muted" />
        </button>

        <PickerDialog
          open={picking}
          onClose={() => setPicking(false)}
          label="Asset"
          options={options}
          value={assetId}
          onChange={setAssetId}
        />

        {error ? (
          <span className="-mt-2 text-base text-negative" role="alert">
            {error}
          </span>
        ) : null}

        {phone ? (
          <p className="text-label text-text-muted">
            Choose what to send, then scan the code with the wallet on your phone — nothing is signed in this
            browser.
          </p>
        ) : (
          <p className="text-label text-text-muted">
            Paid to your connected account, {shortenAddress(address)}. The invoice is only a link — nothing is
            stored, and it cannot be changed once shared.
          </p>
        )}

        <Button
          variant="primary"
          block
          size="lg"
          disabled={!valid}
          onClick={() => setInvoice({ to: address, asset, amount: trimmed })}
        >
          {!trimmed ? 'Enter an amount' : phone ? 'Show payment code' : 'Create invoice'}
        </Button>
      </Modal>

      {invoice ? (
        <InvoiceCreated
          open={open}
          phone={phone}
          invoice={invoice}
          onBack={() => setInvoice(undefined)}
          onClose={onClose}
        />
      ) : null}
    </>
  )
}

/**
 * The made invoice: its code, and a link to share.
 *
 * The code is the URI by default — that is what a wallet on a phone scans —
 * with a switch to the link, for a phone camera that should open the pay page
 * instead. Share always hands over the link, because a link is what can be
 * pasted into a chat and opened by anyone, wallet or not.
 */
function InvoiceCreated({
  open,
  phone,
  invoice,
  onBack,
  onClose
}: {
  open: boolean
  /** Paying from a phone: the URI only — no link to share, nothing to switch. */
  phone: boolean
  invoice: Invoice
  onBack: () => void
  onClose: () => void
}) {
  const hidden = usePrivacy((state) => state.hidden)
  const [target, setTarget] = useState<Target>('uri')
  const [copied, setCopied] = useState(false)

  const link = invoiceUrl(invoice)
  const value = phone || target === 'uri' ? invoiceUri(invoice) : link

  const share = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // Refused clipboard access is not worth an error; the code is on screen.
    }
  }

  return (
    <Modal open={open} onClose={onClose} onBack={onBack} title={phone ? 'Scan to pay' : 'Invoice'}>
      <div className="flex flex-col items-center gap-2 text-center">
        <AssetAmount
          amount={invoice.amount}
          symbol={invoice.asset.symbol}
          image={invoice.asset.image}
          size="md"
        />
        <span className="text-label text-text-muted">
          {invoice.asset.private ? 'Private transfer' : 'Public transfer'}
          {/* Paying from a phone, the recipient was on the page the visitor
              just left; saying it again here is noise. */}
          {phone ? null : ` to ${shortenAddress(invoice.to)}`}
        </span>
      </div>

      <div className="flex flex-col gap-3">
        {/* Switch, code and button all one width — the dialog's. */}
        <div
          className={cn('flex items-center gap-1 rounded-pill border border-border p-1', phone && 'hidden')}
        >
          {(['uri', 'link'] as Target[]).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={target === option}
              onClick={() => setTarget(option)}
              className={cn(
                'state-layer flex-1 rounded-pill px-4 py-1.5 text-sm font-medium',
                'transition-colors duration-[var(--duration-short)] ease-[var(--ease-standard)]',
                target === option ? 'bg-accent-strong text-[var(--color-accent-text)]' : 'text-text-muted'
              )}
            >
              {option === 'uri' ? 'URI' : 'Link'}
            </button>
          ))}
        </div>

        {/*
          On white whatever the theme — scanners need the light modules lighter
          than the dark ones — and covered in privacy mode, since it carries
          the address.
        */}
        {hidden ? (
          <div className="flex aspect-square w-full items-center justify-center gap-2 rounded-card bg-surface text-text-muted">
            <EyeOff size={16} aria-hidden />
            <span className="text-base">Hidden</span>
          </div>
        ) : (
          <div className="w-full rounded-card bg-white p-4">
            <QRCodeSVG
              value={value}
              size={300}
              level="M"
              bgColor="#ffffff"
              fgColor="#000000"
              className="h-auto w-full"
              title={target === 'uri' ? 'Payment URI' : 'Invoice link'}
            />
          </div>
        )}
      </div>

      {phone ? (
        <p className="text-label text-text-muted">
          Open the wallet on your phone and scan this code. It carries the address, the asset and the amount,
          so there is nothing to type there.
        </p>
      ) : (
        <Button
          variant="primary"
          block
          size="lg"
          icon={copied ? <Check size={16} aria-hidden /> : <Share2 size={16} aria-hidden />}
          onClick={() => void share()}
        >
          {copied ? 'Link copied' : 'Share'}
        </Button>
      )}
    </Modal>
  )
}

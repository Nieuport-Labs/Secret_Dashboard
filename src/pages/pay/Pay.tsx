import { EyeOff, FileWarning, Wallet } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import PublicWalletCorner from '@/components/layout/PublicWalletCorner'
import Button from '@/components/ui/Button'
import EmptyState from '@/components/ui/EmptyState'
import AssetAmount from '@/components/wallet/AssetAmount'
import ConnectToSendModal from '@/components/wallet/ConnectToSendModal'
import PayInvoiceModal from '@/components/wallet/PayInvoiceModal'
import { cn } from '@/lib/cn'
import { shortenAddress } from '@/lib/format'
import { invoiceUri, invoiceUrl, parseInvoice } from '@/lib/invoice'
import { profilePath } from '@/lib/profileLink'
import { useProfileIdentity } from '@/hooks/useProfileIdentity'
import { usePrivacy } from '@/store/privacy'
import { useWallet } from '@/store/wallet'

type Target = 'uri' | 'link'

/**
 * An invoice, at `/pay/secret1abc…?asset=…&amount=…`.
 *
 * Built like the profile page and for the same visitor — someone who may never
 * have seen this dashboard — so it sits outside the shell too. The code is on
 * the left for paying from a phone wallet; the invoice itself is on the right
 * for paying from here.
 *
 * It shows whom the invoice pays by their profile name *and* their address.
 * An invoice is only a link, and a link can be made by anyone, so the address
 * is the part that can be checked against what the payer expected.
 */
export default function Pay() {
  const { address = '' } = useParams<{ address: string }>()
  const [params] = useSearchParams()
  const navigate = useNavigate()

  const hidden = usePrivacy((state) => state.hidden)
  const connected = useWallet((state) => state.address)
  const identity = useProfileIdentity(address)

  const [paying, setPaying] = useState(false)
  const [target, setTarget] = useState<Target>('uri')

  const parsed = parseInvoice(address, params)
  const payee = identity.name ?? shortenAddress(address, 10, 6)

  useEffect(() => {
    if (!('invoice' in parsed)) return
    const previous = document.title
    document.title = `Invoice from ${payee} · Secret Dashboard`
    return () => {
      document.title = previous
    }
    // `parsed` is rebuilt every render; what it depends on is listed instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payee, address, params])

  if ('error' in parsed) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-[560px] items-center px-4">
        <EmptyState
          icon={FileWarning}
          title="Not a valid invoice"
          description={`${parsed.error} A link may have been copied incompletely.`}
          action={<Button onClick={() => navigate('/wallet')}>Open Secret Dashboard</Button>}
        />
      </div>
    )
  }

  const { invoice } = parsed
  const isSelf = Boolean(connected) && connected === address
  const value = target === 'uri' ? invoiceUri(invoice) : invoiceUrl(invoice)

  return (
    <div className="flex min-h-dvh flex-col px-4 py-6">
      <PublicWalletCorner />

      {/*
        The profile page's layout: the switch in a row of its own above the
        code, so the invoice lines up with the top of the code. One column on a
        phone, the invoice first.
      */}
      <div className="mx-auto grid w-full max-w-[860px] flex-1 content-center gap-x-12 gap-y-8 pb-[12vh] pt-8 md:grid-cols-[260px_minmax(0,1fr)] md:items-start md:gap-y-4">
        <div className="flex min-w-0 flex-col items-center gap-4 text-center md:col-start-2 md:row-start-2 md:items-start md:text-left">
          {/*
            The amount first — it is what the invoice is — with its token
            beside it, then who it is from, smaller. The full address stays:
            it is the part a payer can check, it just no longer has to lead.
          */}
          <div className="flex flex-col items-center gap-3 md:items-start">
            <AssetAmount amount={invoice.amount} symbol={invoice.asset.symbol} image={invoice.asset.image} />
            <span className="rounded-pill border border-border px-2 py-0.5 text-label text-text-muted">
              {invoice.asset.private ? 'Private transfer' : 'Public transfer'}
            </span>
          </div>

          <div className="flex min-w-0 max-w-full flex-col gap-0.5">
            <span className="text-base text-text-muted">
              From{' '}
              <Link to={profilePath(address)} className="font-medium text-text hover:underline">
                {payee}
              </Link>
            </span>
            <span className="break-address font-mono text-label text-text-faint">{address}</span>
          </div>

          {isSelf ? (
            <p className="text-base text-text-muted">
              This is your invoice. Share the link, and whoever opens it can pay it from here.
            </p>
          ) : (
            <Button
              variant="primary"
              size="lg"
              icon={<Wallet size={16} aria-hidden />}
              onClick={() => setPaying(true)}
            >
              Pay invoice
            </Button>
          )}

          <p className="text-balance text-label text-text-faint">
            An invoice is only a link. Check the address above is the one you expect to pay.
          </p>
        </div>

        {/*
          URI by default — that is what a wallet on a phone scans. The link is
          for a phone camera that should open this page instead.
        */}
        <div className="flex items-center gap-1 justify-self-center rounded-pill border border-border p-1 md:col-start-1 md:row-start-1 md:justify-self-start">
          {(['uri', 'link'] as Target[]).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={target === option}
              onClick={() => setTarget(option)}
              className={cn(
                'state-layer rounded-pill px-4 py-1.5 text-sm font-medium',
                'transition-colors duration-[var(--duration-short)] ease-[var(--ease-standard)]',
                target === option ? 'bg-accent-strong text-[var(--color-accent-text)]' : 'text-text-muted'
              )}
            >
              {option === 'uri' ? 'URI' : 'Link'}
            </button>
          ))}
        </div>

        {/* On white whatever the theme; hidden in privacy mode. */}
        <div className="flex justify-center md:col-start-1 md:row-start-2">
          {hidden ? (
            <div className="flex aspect-square w-full max-w-[260px] items-center justify-center gap-2 rounded-card bg-surface text-text-muted">
              <EyeOff size={16} aria-hidden />
              <span className="text-base">Hidden</span>
            </div>
          ) : (
            <div className="w-full max-w-[260px] rounded-card bg-white p-4">
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
      </div>

      <Link
        to="/wallet"
        className="state-layer mx-auto flex w-fit items-center gap-2 rounded-pill px-2.5 py-1.5 text-text-faint hover:text-text-muted"
      >
        <img src="/img/logo-mark.svg" alt="" className="h-5 w-[19px]" />
        <span className="text-label">Secret Dashboard</span>
      </Link>

      {/* One flow in two steps, as with a tip: connect, then straight on. */}
      {!isSelf && !connected ? (
        <ConnectToSendModal
          open={paying}
          onClose={() => setPaying(false)}
          title="Pay invoice"
          message={`Connect a wallet to pay ${invoice.amount} ${invoice.asset.symbol}.`}
        />
      ) : null}

      {connected && !isSelf ? (
        <PayInvoiceModal open={paying} onClose={() => setPaying(false)} invoice={invoice} />
      ) : null}
    </div>
  )
}

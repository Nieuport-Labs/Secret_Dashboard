import { Check, Copy, EyeOff, HandCoins, UserX } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'

import Button from '@/components/ui/Button'
import EmptyState from '@/components/ui/EmptyState'
import SocialIcon from '@/components/ui/SocialIcon'
import PublicWalletCorner from '@/components/layout/PublicWalletCorner'
import ConnectToSendModal from '@/components/wallet/ConnectToSendModal'
import InvoiceModal from '@/components/wallet/InvoiceModal'
import SendPanel from '@/components/wallet/SendPanel'
import { DISPLAY_DENOM } from '@/chains/secret4'
import { isValidBech32 } from '@/lib/bech32'
import { cn } from '@/lib/cn'
import { shortenAddress } from '@/lib/format'
import { linkHref, LINK_KINDS, type ProfileLink } from '@/lib/profile'
import { profileUrl } from '@/lib/profileLink'
import { useWalletData } from '@/hooks/walletData'
import { useProfileIdentity } from '@/hooks/useProfileIdentity'
import { usePrivacy } from '@/store/privacy'
import { useWallet } from '@/store/wallet'

/** What the QR and the copy button are pointed at. */
type Target = 'link' | 'address'

/**
 * One published link.
 *
 * Rendered as plain text when it has no address — a Discord username is not
 * reachable by URL — rather than as a link that goes nowhere. `linkHref` also
 * returns nothing for a scheme that is not http(s), which is what keeps a
 * `javascript:` URL typed into someone's website field from becoming a trap for
 * every stranger who opens their page.
 */
function LinkChip({ link }: { link: ProfileLink }) {
  const label = LINK_KINDS.find((kind) => kind.kind === link.kind)?.label ?? link.kind
  const href = linkHref(link)

  const className =
    'flex items-center gap-2 rounded-pill border border-border px-3 py-1.5 text-sm text-text-muted'

  // The network by its logo; its name is still there for a screen reader and
  // on hover.
  const content = (
    <>
      <SocialIcon kind={link.kind} size={15} />
      <span className="sr-only">{label}:</span>
      <span className="text-text-faint">{link.value}</span>
    </>
  )

  if (!href) {
    return (
      <span className={className} title={label}>
        {content}
      </span>
    )
  }

  return (
    /* `noreferrer` as well as `noopener`: these destinations are chosen by the
       profile's owner, and a visitor's referrer is not theirs to hand over. */
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      title={label}
      className={cn(className, 'state-layer')}
    >
      {content}
    </a>
  )
}

/**
 * Someone's public profile, at `/secret1abc…`.
 *
 * Rendered outside the app shell. This is the one page reached by people who
 * have never seen this dashboard — a rail of destinations they cannot use yet
 * would frame someone's personal page as a product tour, so the page carries
 * only what it needs and one quiet way into the rest.
 *
 * It is deliberately **not** an explorer. It shows who is being paid and how to
 * pay them, and nothing about what they hold. The bank balances are public on
 * chain and could be read here, but gathering them onto the page someone hands
 * out is a different act from their being technically available: on a chain
 * whose point is privacy, a tip link that also publishes the recipient's
 * balance makes them a target.
 */
export default function Profile() {
  const { address = '' } = useParams<{ address: string }>()
  const navigate = useNavigate()

  const hidden = usePrivacy((state) => state.hidden)
  const connected = useWallet((state) => state.address)

  const identity = useProfileIdentity(address)

  const valid = isValidBech32(address, 'secret')
  const isSelf = Boolean(connected) && connected === address

  const [tipping, setTipping] = useState(false)
  const [tippingByPhone, setTippingByPhone] = useState(false)
  const [target, setTarget] = useState<Target>('address')
  const [copied, setCopied] = useState(false)

  /*
   * The visitor's own balances — this is what a tip is sent *from*. The
   * profile's owner is not the source of anything here, and their private
   * holdings are unreadable from this page in any case.
   */
  const { balances } = useWalletData()

  // The tab, so a profile is findable among a dozen of them. Crawlers do not
  // run this, which is why a shared link's card is the static one from
  // index.html rather than anything set here.
  useEffect(() => {
    if (!valid) return
    const previous = document.title
    document.title = `${identity.name ?? shortenAddress(address)} · Secret Dashboard`
    return () => {
      document.title = previous
    }
  }, [address, identity.name, valid])

  /*
   * A bare `/:address` route matches any single segment, so everything the app
   * does not otherwise recognise arrives here — both broken profile links and
   * plain mistyped page names. They are different mistakes and get different
   * answers, told apart by the prefix.
   *
   * `/walet` was never a profile link, so it keeps the behaviour it had before
   * this route existed: the catch-all's redirect. Answering it with "not a
   * Secret address" would be true and useless.
   */
  if (!valid && !address.startsWith('secret1')) {
    return <Navigate to="/wallet" replace />
  }

  /*
   * This one *was* meant to be an address — it carries the prefix and fails
   * its checksum — so it is owed the reason rather than a silent redirect
   * somewhere else, which reads as the app being broken.
   */
  if (!valid) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-[560px] items-center px-4">
        <EmptyState
          icon={UserX}
          title="Not a Secret address"
          description={`“${shortenAddress(address, 12, 6)}” is not a valid address on this chain. A link may have been copied incompletely.`}
          action={<Button onClick={() => navigate('/wallet')}>Open Secret Dashboard</Button>}
        />
      </div>
    )
  }

  const value = target === 'link' ? profileUrl(address) : address

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // Refused clipboard access is not worth an error; the value is on screen.
    }
  }

  return (
    <div className="flex min-h-dvh flex-col px-4 py-6">
      <PublicWalletCorner />

      {/*
        Two columns once there is room: the code on the left, who this is and
        what you can do for them on the right. The switch sits in a row of its
        own above the code, so the name lines up with the top of the code
        rather than with the switch. On a phone it is one column, identity
        first, so the name is the first thing read.
      */}
      <div className="mx-auto grid w-full max-w-[860px] flex-1 content-center gap-x-6 gap-y-8 pb-[12vh] pt-8 md:grid-cols-[260px_minmax(0,1fr)] md:items-start md:gap-y-4">
        <div className="flex min-w-0 flex-col items-center gap-5 text-center md:col-start-2 md:row-start-2 md:items-start md:text-left">
          <h1 className="text-display break-words">{identity.name ?? shortenAddress(address, 10, 6)}</h1>

          {identity.bio ? <p className="text-balance text-base text-text-muted">{identity.bio}</p> : null}

          {identity.links.length > 0 ? (
            <div className="flex flex-wrap items-center justify-center gap-2 md:justify-start">
              {identity.links.map((link) => (
                <LinkChip key={link.kind} link={link} />
              ))}
            </div>
          ) : null}

          {isSelf ? (
            // Offering to tip yourself is nonsense, and someone opening their own
            // link is here to check what everyone else will see.
            <p className="text-base text-text-muted">
              This is your profile. Share it and anyone can send you {DISPLAY_DENOM}.
            </p>
          ) : (
            /*
              Offered whether or not a wallet is connected. Connecting is the
              first step of the tip itself, not something the page asks of
              everyone who opens it — most visitors are here to read, not pay.
            */
            <Button
              variant="primary"
              size="lg"
              icon={<HandCoins size={16} aria-hidden />}
              onClick={() => setTipping(true)}
            >
              Send a tip
            </Button>
          )}

          <p className="text-balance text-label text-text-faint">
            Anyone can open this page. It shows this address and nothing about what is held there.
          </p>
        </div>

        {/*
            Two things worth handing to someone, and they are not
            interchangeable: the link opens this page, the address is what a
            wallet scans. The switch changes only the code; the row beneath it
            is always the address, since that is what gets pasted into a send.
          */}
        <div className="flex items-center gap-1 justify-self-center rounded-pill border border-border p-1 md:col-start-1 md:row-start-1 md:justify-self-start">
          {(['address', 'link'] as Target[]).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={target === option}
              onClick={() => setTarget(option)}
              className={cn(
                'state-layer rounded-pill px-4 py-1.5 text-sm font-medium capitalize',
                'transition-colors duration-[var(--duration-short)] ease-[var(--ease-standard)]',
                target === option ? 'bg-accent-strong text-[var(--color-accent-text)]' : 'text-text-muted'
              )}
            >
              {option}
            </button>
          ))}
        </div>

        <div className="flex flex-col items-center gap-4 md:col-start-1 md:row-start-2">
          {/*
            The QR stays on white whatever the theme. Scanners rely on the light
            modules being lighter than the dark ones, and inverting a code is the
            one "dark mode everywhere" decision that stops it working.
          */}
          {hidden ? (
            <div className="flex w-full max-w-[260px] items-center justify-center gap-2 rounded-card bg-surface px-4 py-10 text-text-muted">
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
                title={
                  target === 'link' ? `Profile link for ${address}` : `Secret Network address ${address}`
                }
              />
            </div>
          )}

          {/*
            One row, as wide as the code above it. The address is shortened
            rather than wrapped over three lines — the button copies all of it.
            `shortenAddress` also masks itself in privacy mode.
          */}
          <button
            type="button"
            onClick={() => void copy()}
            className="state-layer flex w-full max-w-[260px] min-w-0 items-center justify-between gap-3 rounded-control px-3 py-2 text-text-muted"
          >
            <span className="min-w-0 truncate font-mono text-sm">{shortenAddress(address, 12, 6)}</span>
            <span className="flex shrink-0 items-center gap-1.5 text-label">
              {copied ? (
                <Check size={13} aria-hidden className="text-positive" />
              ) : (
                <Copy size={13} aria-hidden />
              )}
              {copied ? 'Copied' : 'Copy'}
              <span className="sr-only">address</span>
            </span>
          </button>
        </div>
      </div>

      {/* The only way out, small and at the foot on purpose — this page
          belongs to the person it names, not to the dashboard hosting it. */}
      <Link
        to="/wallet"
        className="state-layer mx-auto flex w-fit items-center gap-2 rounded-pill px-2.5 py-1.5 text-text-faint hover:text-text-muted"
      >
        <img src="/img/logo-mark.svg" alt="" className="h-5 w-[19px]" />
        <span className="text-label">Secret Dashboard</span>
      </Link>

      {/*
        The tip is one flow in two steps. Without a wallet it opens on the
        choice of one; the moment the connection lands `connected` is set and
        the same open state carries straight on into the send form — no second
        click, no trip to the wallet screen. The send form itself is rendered
        only once there is a wallet to send from: its send path returns
        silently without a connected client.
      */}
      {!isSelf && !connected ? (
        <ConnectToSendModal
          open={tipping}
          onClose={() => setTipping(false)}
          title="Send a tip"
          message={`Connect a wallet to send ${DISPLAY_DENOM}.`}
          qrLabel="Tip with QR code"
          onQr={() => {
            setTipping(false)
            setTippingByPhone(true)
          }}
        />
      ) : null}

      {/* The tip from a phone: choose an asset and an amount, then scan the
          payment URI. Back returns to the choice of wallet. */}
      <InvoiceModal
        open={tippingByPhone}
        onClose={() => setTippingByPhone(false)}
        onBack={() => {
          setTippingByPhone(false)
          setTipping(true)
        }}
        address={address}
        purpose="phone"
      />

      {connected && !isSelf ? (
        <SendPanel
          open={tipping}
          onClose={() => setTipping(false)}
          balances={balances}
          recipient={address}
          recipientLocked
          onDone={balances.refresh}
        />
      ) : null}
    </div>
  )
}

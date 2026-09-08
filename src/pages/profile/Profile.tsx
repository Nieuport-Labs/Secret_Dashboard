import { Check, Copy, HandCoins, UserX } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'

import Button from '@/components/ui/Button'
import EmptyState from '@/components/ui/EmptyState'
import Avatar from '@/components/wallet/Avatar'
import SendPanel from '@/components/wallet/SendPanel'
import { DISPLAY_DENOM } from '@/chains/secret4'
import { isValidBech32 } from '@/lib/bech32'
import { cn } from '@/lib/cn'
import { shortenAddress } from '@/lib/format'
import { profileUrl } from '@/lib/profileLink'
import { WALLETS, type WalletId } from '@/lib/wallet'
import { useBalances } from '@/hooks/useBalances'
import { usePermit } from '@/hooks/usePermit'
import { useProfileIdentity } from '@/hooks/useProfileIdentity'
import { useWallet } from '@/store/wallet'

/** What the QR and the copy button are pointed at. */
type Target = 'link' | 'address'

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

  const connected = useWallet((state) => state.address)
  const status = useWallet((state) => state.status)
  const walletId = useWallet((state) => state.walletId)
  const walletError = useWallet((state) => state.error)
  const notInstalled = useWallet((state) => state.notInstalled)
  const connectWallet = useWallet((state) => state.connectWallet)

  const identity = useProfileIdentity(address)

  const valid = isValidBech32(address, 'secret')
  const isSelf = Boolean(connected) && connected === address

  const [tipping, setTipping] = useState(false)
  const [target, setTarget] = useState<Target>('link')
  const [copied, setCopied] = useState(false)

  /*
   * The visitor's own balances — this is what a tip is sent *from*. The
   * profile's owner is not the source of anything here, and their private
   * holdings are unreadable from this page in any case.
   */
  const { permit } = usePermit()
  const balances = useBalances(permit)

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

  const link = profileUrl(address)
  const value = target === 'link' ? link : address
  const connecting = status === 'connecting'

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // Refused clipboard access is not worth an error; the value is on screen.
    }
  }

  return (
    <div className="flex min-h-dvh flex-col px-4 py-6">
      {/* The only way out, and small on purpose — this page belongs to the
          person it names, not to the dashboard hosting it. */}
      <Link
        to="/wallet"
        className="state-layer mx-auto flex w-fit items-center gap-2 rounded-pill px-2.5 py-1.5 text-text-faint hover:text-text-muted"
      >
        <img src="/img/logo-mark.svg" alt="" className="h-5 w-[19px]" />
        <span className="text-label">Secret Dashboard</span>
      </Link>

      <div className="mx-auto flex w-full max-w-[380px] flex-1 flex-col items-center justify-center gap-5 py-8 text-center">
        <Avatar address={address} url={identity.avatarUrl} size={88} />

        <h1 className="text-display">{identity.name ?? shortenAddress(address, 10, 6)}</h1>

        {/*
          Two things worth handing to someone, and they are not
          interchangeable: the link opens this page, the address is what a
          wallet scans. One control switches both the code and what the button
          copies, so there is never a QR showing one thing and a button
          copying the other.
        */}
        <div className="flex items-center gap-1 rounded-pill border border-border p-1">
          {(['link', 'address'] as Target[]).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={target === option}
              onClick={() => {
                setTarget(option)
                setCopied(false)
              }}
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

        {/*
          The QR stays on white whatever the theme. Scanners rely on the light
          modules being lighter than the dark ones, and inverting a code is the
          one "dark mode everywhere" decision that stops it working.
        */}
        <div className="w-full max-w-[260px] rounded-card bg-white p-4">
          <QRCodeSVG
            value={value}
            size={300}
            level="M"
            bgColor="#ffffff"
            fgColor="#000000"
            className="h-auto w-full"
            title={target === 'link' ? `Profile link for ${address}` : `Secret Network address ${address}`}
          />
        </div>

        <button
          type="button"
          onClick={() => void copy()}
          className="state-layer flex w-full min-w-0 flex-col items-center gap-1.5 rounded-control px-3 py-2 text-text-muted"
        >
          <span className="break-address min-w-0 font-mono text-sm">{value}</span>
          <span className="flex items-center gap-1.5 text-label">
            {copied ? (
              <>
                <Check size={13} aria-hidden className="text-positive" />
                Copied
              </>
            ) : (
              <>
                <Copy size={13} aria-hidden />
                Copy {target}
              </>
            )}
          </span>
        </button>

        {isSelf ? (
          // Offering to tip yourself is nonsense, and someone opening their own
          // link is here to check what everyone else will see.
          <p className="text-base text-text-muted">
            This is your profile. Share it and anyone can send you {DISPLAY_DENOM}.
          </p>
        ) : connected ? (
          <Button
            variant="primary"
            size="lg"
            icon={<HandCoins size={16} aria-hidden />}
            onClick={() => setTipping(true)}
          >
            Send a tip
          </Button>
        ) : (
          /*
            Connecting happens here rather than on the wallet screen. Sending
            someone away to connect and trusting them to find their way back is
            where a tip stops happening — and with no shell around this page,
            "go to the wallet" would also be a one-way door.
          */
          <div className="flex w-full flex-col gap-2.5">
            {(['keplr', 'starshell'] as WalletId[]).map((id) => (
              <Button
                key={id}
                variant="secondary"
                size="lg"
                block
                loading={connecting && walletId === id}
                disabled={connecting}
                onClick={() => void connectWallet(id)}
                icon={<img src={WALLETS[id].icon} alt="" className="size-6 rounded-pill" />}
              >
                Connect {WALLETS[id].name} to tip
              </Button>
            ))}

            {/* A missing extension is a next step, not a fault, so it gets a
                link rather than a red message. */}
            {status === 'error' && walletError ? (
              <p className="text-base text-text-muted" role="status">
                {walletError}{' '}
                {notInstalled && walletId ? (
                  <a
                    className="text-accent underline underline-offset-4"
                    href={WALLETS[walletId].installUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    Install {WALLETS[walletId].name}
                  </a>
                ) : null}
              </p>
            ) : null}
          </div>
        )}

        <p className="text-balance text-label text-text-faint">
          Anyone can open this page. It shows this address and nothing about what is held there.
        </p>
      </div>

      {/*
        Rendered only once there is a wallet to send from: the panel's send path
        returns silently without a connected client, so opening it while
        disconnected would show a form that quietly does nothing.
      */}
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

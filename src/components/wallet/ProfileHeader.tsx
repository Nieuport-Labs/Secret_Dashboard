import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import Avatar from '@/components/wallet/Avatar'
import type { WalletPanel } from '@/components/wallet/panels'
import Button from '@/components/ui/Button'
import { DISPLAY_DENOM } from '@/chains/secret4'
import { useProfileImage } from '@/hooks/useProfileImage'
import { formatDisplayAmount, formatFiat, shortenAddress } from '@/lib/format'
import { useSettings } from '@/store/settings'

interface Props {
  address: string
  /** Native SCRT in base units. Undefined while loading or when the read failed. */
  native?: string
  nativeFiat?: number
  loading: boolean
  onOpenPanel: (panel: WalletPanel) => void
}

/**
 * The wallet's identity row (Figma 36:157): who you are on the left, what you
 * hold on the right.
 *
 * "Total $SCRT Available" in the design means the native balance, not the sum
 * of everything held — it is the figure that decides whether you can pay for a
 * transaction, which is why it earns the largest type on the screen.
 */
export default function ProfileHeader({ address, native, nativeFiat, loading, onOpenPanel }: Props) {
  const navigate = useNavigate()
  const currency = useSettings((state) => state.currency)
  const { url, upload, remove, saving, error } = useProfileImage()
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // Clipboard access can be refused; the address is on screen to select.
    }
  }

  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-stretch">
        <Avatar
          address={address}
          url={url}
          onPick={(file) => void upload(file)}
          onRemove={() => void remove()}
          saving={saving}
        />

        <div className="flex flex-col justify-between gap-4">
          <div>
            <h1 className="text-headline">Hello 👋</h1>
            <button
              type="button"
              onClick={() => void copy()}
              className="state-layer -mx-1 mt-0.5 flex max-w-full items-center gap-1.5 rounded-control px-1 text-base font-semibold text-text-faint"
            >
              {/*
                A bech32 address is 45 characters and will not fit narrow
                layouts. Breaking it anywhere leaves a line holding one letter,
                so it is elided in the middle instead, and shown whole only
                where the design's single line actually fits.
              */}
              <span className="whitespace-nowrap md:hidden">{shortenAddress(address, 12, 6)}</span>
              <span className="hidden whitespace-nowrap md:inline">{address}</span>
              {copied ? (
                <Check size={14} aria-hidden className="shrink-0 text-positive" />
              ) : (
                <Copy size={14} aria-hidden className="shrink-0" />
              )}
              <span className="sr-only">{copied ? 'Address copied' : 'Copy address'}</span>
            </button>
          </div>

          <div className="flex w-full max-w-[388px] gap-2.5">
            <Button
              variant="soft"
              shape="control"
              size="lg"
              className="flex-1"
              onClick={() => onOpenPanel('send')}
            >
              Send
            </Button>
            <Button
              variant="soft"
              shape="control"
              size="lg"
              className="flex-1"
              onClick={() => onOpenPanel('receive')}
            >
              Receive
            </Button>
            <Button
              variant="soft"
              shape="control"
              size="lg"
              className="flex-1"
              onClick={() => onOpenPanel('wrap')}
            >
              Wrap
            </Button>
            <Button
              variant="soft"
              shape="control"
              size="lg"
              className="flex-1"
              onClick={() => navigate('/bridge')}
            >
              Bridge
            </Button>
          </div>
        </div>
      </div>

      {error ? (
        <p className="text-base text-negative" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex w-full items-center justify-between gap-4 lg:w-[400px]">
        {/*
          The design writes this "Total $SCRT Available" and colours the figure
          orange. Both are dropped: a ticker does not take a dollar sign outside
          a trading forum, and colour on a number means something changed — a
          balance that is permanently orange has spent that signal on nothing.
        */}
        <div>
          <p className="text-label text-text-muted">Available</p>
          {loading && native === undefined ? (
            <span className="mt-1.5 block h-8 w-32 animate-pulse rounded-control bg-surface" />
          ) : (
            <p className="mt-1.5 text-headline tabular-nums">
              {native === undefined ? (
                'Unavailable'
              ) : (
                <>
                  {formatDisplayAmount(native)}{' '}
                  <span className="text-title text-text-muted">{DISPLAY_DENOM}</span>
                </>
              )}
            </p>
          )}
          <p className="mt-0.5 text-label text-text-faint">{formatFiat(nativeFiat, currency)}</p>
        </div>

        <Button variant="soft" shape="control" onClick={() => navigate('/staking')}>
          Stake
        </Button>
      </div>
    </div>
  )
}

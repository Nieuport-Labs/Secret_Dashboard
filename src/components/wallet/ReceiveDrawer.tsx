import { Check, Copy, EyeOff, Link as LinkIcon } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import Button from '@/components/ui/Button'
import Drawer from '@/components/ui/Drawer'
import Private from '@/components/ui/Private'
import { DISPLAY_DENOM } from '@/chains/secret4'
import { shortenAddress } from '@/lib/format'
import { profileUrl } from '@/lib/profileLink'
import { usePrivacy } from '@/store/privacy'

interface Props {
  open: boolean
  onClose: () => void
  address: string
}

/**
 * Receive (Figma 31:531): the address as a QR code, as text, and a way to
 * bridge in for someone who has nothing on Secret to receive yet.
 */
export default function ReceiveDrawer({ open, onClose, address }: Props) {
  const navigate = useNavigate()
  const hidden = usePrivacy((state) => state.hidden)
  const [copied, setCopied] = useState<'address' | 'link' | undefined>()

  const copy = async (value: string, which: 'address' | 'link') => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(which)
      setTimeout(() => setCopied(undefined), 1600)
    } catch {
      // Refused clipboard access is not worth an error; the address is visible.
    }
  }

  return (
    <Drawer open={open} onClose={onClose} title="Receive">
      {/*
        The QR stays on white whatever the theme. Scanners rely on the light
        modules being lighter than the dark ones, and inverting a code is the
        one "dark mode everywhere" decision that stops it working.
      */}
      {/* Privacy mode covers the code as well as the text. A QR is an address
          in a form a phone can read from across a room, which makes it the last
          thing that should stay on screen during a screen share. */}
      {hidden ? (
        <div className="flex items-center justify-center gap-2 rounded-card bg-surface px-4 py-10 text-text-muted">
          <EyeOff size={16} aria-hidden />
          <span className="text-base">Hidden while privacy mode is on</span>
        </div>
      ) : (
        <div className="rounded-card bg-white p-4">
          <QRCodeSVG
            value={address}
            size={300}
            level="M"
            bgColor="#ffffff"
            fgColor="#000000"
            className="h-auto w-full"
            title={`Secret Network address ${address}`}
          />
        </div>
      )}

      <div className="flex items-start justify-between gap-3">
        <p className="break-address text-base font-semibold">
          <Private mask={shortenAddress(address)}>{address}</Private>
        </p>
        <button
          type="button"
          onClick={() => void copy(address, 'address')}
          className="state-layer flex shrink-0 items-center gap-1.5 rounded-control px-2 py-1 text-base text-text-muted"
        >
          {copied === 'address' ? (
            <Check size={16} aria-hidden className="text-positive" />
          ) : (
            <Copy size={16} aria-hidden />
          )}
          {copied === 'address' ? 'Copied' : 'Copy'}
        </button>
      </div>

      {/*
        The profile link belongs here, because "Receive" is already the screen
        for how people pay you — but below the QR and clearly separate, since
        the two are not interchangeable. The code above encodes the bare
        address for a wallet scanner; this is a web page for a human. Swapping
        the QR to the URL would quietly break every wallet that scans it.
      */}
      <div className="flex flex-col gap-2 rounded-card border border-border p-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-label text-text-muted">Or share your profile</span>
          <button
            type="button"
            onClick={() => void copy(profileUrl(address), 'link')}
            className="state-layer flex shrink-0 items-center gap-1.5 rounded-control px-2 py-1 text-base text-text-muted"
          >
            {copied === 'link' ? (
              <Check size={16} aria-hidden className="text-positive" />
            ) : (
              <LinkIcon size={16} aria-hidden />
            )}
            {copied === 'link' ? 'Copied' : 'Copy link'}
          </button>
        </div>
        {/* The profile link carries the address in it, so hiding the address
            and printing the link would hide nothing at all. */}
        <p className="break-address text-sm text-text-faint">
          <Private mask={profileUrl(shortenAddress(address))}>{profileUrl(address)}</Private>
        </p>
        <p className="text-sm text-text-muted">
          A page anyone can open to send you something. It shows this address and nothing about what you hold.
        </p>
      </div>

      <div className="flex items-center gap-2.5">
        <span className="h-px flex-1 bg-border" />
        <span className="text-base text-text-muted">or</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <Button
        variant="primary"
        block
        size="lg"
        onClick={() => {
          onClose()
          navigate('/bridge')
        }}
      >
        Bridge
      </Button>

      <p className="text-base text-text-muted">
        This address receives {DISPLAY_DENOM} and any IBC token. Private SNIP-20 tokens are held by their own
        contracts, and arrive here the same way.
      </p>
    </Drawer>
  )
}

import { Check, Copy } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import Button from '@/components/ui/Button'
import Drawer from '@/components/ui/Drawer'
import { DISPLAY_DENOM } from '@/chains/secret4'

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
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
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

      <div className="flex items-start justify-between gap-3">
        <p className="break-address text-base font-semibold">{address}</p>
        <button
          type="button"
          onClick={() => void copy()}
          className="state-layer flex shrink-0 items-center gap-1.5 rounded-control px-2 py-1 text-base text-text-muted"
        >
          {copied ? (
            <Check size={16} aria-hidden className="text-positive" />
          ) : (
            <Copy size={16} aria-hidden />
          )}
          {copied ? 'Copied' : 'Copy'}
        </button>
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

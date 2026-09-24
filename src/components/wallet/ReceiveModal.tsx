import { ArrowLeftRight, Check, Copy, EyeOff, ReceiptText } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import Private from '@/components/ui/Private'
import InvoiceModal from '@/components/wallet/InvoiceModal'
import { DISPLAY_DENOM } from '@/chains/secret4'
import { shortenAddress } from '@/lib/format'
import { usePrivacy } from '@/store/privacy'

interface Props {
  open: boolean
  onClose: () => void
  address: string
}

/**
 * Receive (Figma 31:531): the address as a QR code, as text, and a way to
 * bridge in for someone who has nothing on Secret to receive yet.
 *
 * The shareable profile link used to sit below the QR and now lives in the
 * profile dialog instead. It was never quite at home here: this screen answers
 * "where do I send it", and a second address-shaped string underneath the one
 * being scanned is the last thing that question needs.
 */
export default function ReceiveModal({ open, onClose, address }: Props) {
  const navigate = useNavigate()
  const hidden = usePrivacy((state) => state.hidden)
  const [copied, setCopied] = useState(false)
  const [invoicing, setInvoicing] = useState(false)

  // Always opens on Receive itself, not on the invoice it was left on.
  useEffect(() => {
    if (open) setInvoicing(false)
  }, [open])

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // Refused clipboard access is not worth an error; the address is visible.
    }
  }

  return (
    <>
      <Modal open={open && !invoicing} onClose={onClose} title="Receive" size="lg">
        {/*
        Two columns once there is room, as on the profile page: the code on the
        left, the address and the other way in on the right, with the address
        level with the top of the code. One column on a phone.
      */}
        <div className="grid gap-5 sm:grid-cols-[200px_minmax(0,1fr)] sm:items-start">
          {/*
          The QR stays on white whatever the theme. Scanners rely on the light
          modules being lighter than the dark ones, and inverting a code is the
          one "dark mode everywhere" decision that stops it working.

          Privacy mode covers the code as well as the text. A QR is an address
          in a form a phone can read from across a room, which makes it the
          last thing that should stay on screen during a screen share.
        */}
          {hidden ? (
            <div className="mx-auto flex aspect-square w-full max-w-[200px] items-center justify-center gap-2 rounded-card bg-surface px-4 text-text-muted">
              <EyeOff size={16} aria-hidden />
              <span className="text-base">Hidden</span>
            </div>
          ) : (
            <div className="mx-auto w-full max-w-[200px] rounded-card bg-white p-3">
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

          <div className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-col gap-2">
              <span className="text-label text-text-muted">Your address</span>
              <p className="break-address font-mono text-sm">
                <Private mask={shortenAddress(address)}>{address}</Private>
              </p>
              <Button
                variant="secondary"
                shape="control"
                size="sm"
                className="self-start"
                icon={
                  copied ? (
                    <Check size={16} aria-hidden className="text-positive" />
                  ) : (
                    <Copy size={16} aria-hidden />
                  )
                }
                onClick={() => void copy(address)}
              >
                {copied ? 'Copied' : 'Copy address'}
              </Button>
            </div>

            <p className="text-label text-text-muted">
              This address receives {DISPLAY_DENOM} and any IBC token. Private SNIP-20 tokens are held by
              their own contracts, and arrive here the same way.
            </p>
          </div>
        </div>

        {/*
        The two other ways money arrives, side by side under both columns:
        bringing it in from another chain, or asking someone for a set amount.
      */}
        <div className="grid grid-cols-2 gap-2.5">
          <Button
            variant="secondary"
            block
            size="lg"
            icon={<ArrowLeftRight size={16} aria-hidden />}
            onClick={() => {
              onClose()
              navigate('/bridge')
            }}
          >
            Bridge in
          </Button>
          <Button
            variant="primary"
            block
            size="lg"
            icon={<ReceiptText size={16} aria-hidden />}
            onClick={() => setInvoicing(true)}
          >
            Create invoice
          </Button>
        </div>
      </Modal>

      {/* Opened from here, and returns here: Back on the invoice form brings
        Receive back rather than dropping the user on the wallet screen. */}
      <InvoiceModal
        open={open && invoicing}
        onClose={() => {
          setInvoicing(false)
          onClose()
        }}
        onBack={() => setInvoicing(false)}
        address={address}
      />
    </>
  )
}

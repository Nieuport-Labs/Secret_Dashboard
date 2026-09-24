import { QrCode } from 'lucide-react'

import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { WALLETS, type WalletId } from '@/lib/wallet'
import { useWallet } from '@/store/wallet'

interface Props {
  open: boolean
  onClose: () => void
  title: string
  /** One line on why a wallet is needed here. */
  message: string
  /**
   * Offers paying by QR code instead of connecting a wallet here — for the
   * visitor whose wallet is on their phone, not in this browser.
   */
  onQr?: () => void
  /** The label on that option, worded for what is being paid — "Tip with QR code". */
  qrLabel?: string
}

/**
 * The first step of paying someone from a page outside the app shell — a tip
 * on a profile, an invoice on a pay link.
 *
 * Those pages cannot use the shell's own wallet dialog (they are not inside
 * it), and sending someone to the wallet screen to connect and trusting them
 * to find their way back is where a payment stops happening. So the page opens
 * this, and as soon as the connection lands the caller swaps it for the
 * payment itself under the same open state — no second click.
 */
export default function ConnectToSendModal({
  open,
  onClose,
  title,
  message,
  onQr,
  qrLabel = 'Pay with QR code'
}: Props) {
  const status = useWallet((state) => state.status)
  const walletId = useWallet((state) => state.walletId)
  const error = useWallet((state) => state.error)
  const notInstalled = useWallet((state) => state.notInstalled)
  const connectWallet = useWallet((state) => state.connectWallet)

  const connecting = status === 'connecting'

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p className="text-base text-text-muted">{message}</p>
      <div className="flex flex-col gap-2.5">
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
            Connect {WALLETS[id].name}
          </Button>
        ))}

        {onQr ? (
          <Button
            variant="secondary"
            size="lg"
            block
            disabled={connecting}
            onClick={onQr}
            icon={<QrCode size={18} aria-hidden />}
          >
            {qrLabel}
          </Button>
        ) : null}
      </div>

      {/* A missing extension is a next step, not a fault, so it gets a link
          rather than a red message. */}
      {status === 'error' && error ? (
        <p className="text-base text-text-muted" role="status">
          {error}{' '}
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
    </Modal>
  )
}

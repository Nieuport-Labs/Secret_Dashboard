import { ExternalLink } from 'lucide-react'
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { WALLETS, type WalletId } from '@/lib/wallet'
import { useConnectDialog } from '@/store/connectDialog'
import { useWallet } from '@/store/wallet'

/** The two this dashboard signs with. Both speak the Keplr provider API. */
const OFFERED: WalletId[] = ['keplr', 'starshell']

/**
 * The wallet picker (Figma 30:386), as a dialog.
 *
 * It used to be the whole wallet screen — which meant the one route named after
 * the thing you own showed a sales pitch instead, and every other screen's
 * "Connect a wallet" button was really a link to somewhere else. Connecting is
 * a decision you make from wherever you are and return from, so it is a dialog:
 * the page behind it stays put, and the button that opened it is still there
 * when it closes.
 *
 * Mounted once, in the shell. Anything can open it through `useConnectDialog`.
 */
export default function ConnectWalletModal() {
  const navigate = useNavigate()
  const open = useConnectDialog((state) => state.open)
  const hide = useConnectDialog((state) => state.hide)

  const status = useWallet((state) => state.status)
  const walletId = useWallet((state) => state.walletId)
  const error = useWallet((state) => state.error)
  const notInstalled = useWallet((state) => state.notInstalled)
  const connectWallet = useWallet((state) => state.connectWallet)

  const connecting = status === 'connecting'

  // The dialog asked one question and it has been answered. Leaving it up over
  // the wallet it just connected would make the user close their own success.
  useEffect(() => {
    if (open && status === 'connected') hide()
  }, [open, status, hide])

  return (
    <Modal
      open={open}
      onClose={hide}
      title="Connect a wallet"
      description="Secret Network is a privacy-preserving smart contract chain on the Cosmos stack. Your keys stay in the extension; this dashboard only ever asks it to sign."
    >
      <div className="flex flex-col gap-2.5">
        {OFFERED.map((id) => (
          <Button
            key={id}
            variant="secondary"
            size="lg"
            shape="control"
            block
            loading={connecting && walletId === id}
            disabled={connecting}
            onClick={() => void connectWallet(id)}
            icon={<img src={WALLETS[id].icon} alt="" className="size-6 rounded-pill" />}
          >
            Continue with {WALLETS[id].name}
          </Button>
        ))}
      </div>

      {/* A missing extension is not an error to apologise for, it is a next
          step, so it gets a link rather than a red message. */}
      {status === 'error' && error ? (
        <p className="text-base text-text-muted" role="status">
          {error}{' '}
          {notInstalled && walletId ? (
            <a
              className="inline-flex items-center gap-1 text-accent underline underline-offset-4"
              href={WALLETS[walletId].installUrl}
              target="_blank"
              rel="noreferrer noopener"
            >
              Install {WALLETS[walletId].name}
              <ExternalLink size={14} aria-hidden />
            </a>
          ) : null}
        </p>
      ) : null}

      <div className="flex items-center gap-2.5">
        <span className="h-px flex-1 bg-border" />
        <span className="text-base text-text-muted">or</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <Button
        variant="primary"
        size="lg"
        shape="control"
        block
        onClick={() => {
          hide()
          navigate('/onboarding')
        }}
      >
        I&rsquo;m new (launch onboarding)
      </Button>
    </Modal>
  )
}

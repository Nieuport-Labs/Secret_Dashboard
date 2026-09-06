import { ExternalLink } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import Button from '@/components/ui/Button'
import { WALLETS, type WalletId } from '@/lib/wallet'
import { useWallet } from '@/store/wallet'

/**
 * The unconnected state (Figma 30:386). Wallet choice on the left, a sentence
 * about what Secret Network is on the right, and a way in for someone who has
 * neither a wallet nor a reason to trust one yet.
 *
 * The Figma labels read "Kepler" and "Iam new"; both are corrected here, since
 * they are user-facing copy and the wallet spells itself Keplr.
 */
export default function Welcome() {
  const navigate = useNavigate()
  const status = useWallet((state) => state.status)
  const walletId = useWallet((state) => state.walletId)
  const error = useWallet((state) => state.error)
  const notInstalled = useWallet((state) => state.notInstalled)
  const connectWallet = useWallet((state) => state.connectWallet)

  const connecting = status === 'connecting'

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="flex flex-col items-start gap-8 lg:flex-row lg:items-stretch lg:gap-10">
        <div className="flex w-full flex-col gap-5 lg:w-[360px]">
          <div>
            <h1 className="text-display text-accent">Welcome to Secret</h1>
            <p className="mt-1 text-base text-text-faint">
              Dashboard <span className="text-text-muted">1.9</span>
            </p>
          </div>

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

          <Button variant="primary" size="lg" block onClick={() => navigate('/onboarding')}>
            I&rsquo;m new (launch onboarding)
          </Button>
        </div>

        <span aria-hidden className="hidden w-px self-stretch bg-border lg:block" />

        {/* Roughly 40 characters a line. The design sets this column narrow on
            purpose — it is the one piece of prose on the screen and it reads
            like a caption rather than a paragraph of terms. */}
        <div className="max-w-[230px] text-balance">
          <p className="text-title font-normal">
            Secret Network is a privacy preserving smart contract chain powered by the Cosmos stack.
          </p>
          <p className="mt-3 text-base text-text-faint">Use and build dapps that value your privacy.</p>
        </div>
      </div>
    </div>
  )
}

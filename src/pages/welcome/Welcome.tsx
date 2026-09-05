import { useNavigate } from 'react-router-dom'

import Button from '@/components/ui/Button'

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

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="flex flex-col items-start gap-[30px] lg:flex-row lg:items-stretch">
        <div className="flex w-full flex-col gap-5 lg:w-[400px]">
          <div>
            <h1 className="text-4xl font-semibold text-accent">Welcome to Secret</h1>
            <p className="text-base text-text-faint">
              Dashboard <span className="text-text">1.9</span>
            </p>
          </div>

          <div className="flex flex-col gap-[15px]">
            <Button
              variant="secondary"
              size="lg"
              block
              icon={<img src="/img/wallet-keplr.png" alt="" className="size-[30px] rounded-pill" />}
            >
              Continue with Keplr
            </Button>
            <Button
              variant="secondary"
              size="lg"
              block
              icon={<img src="/img/wallet-starshell.png" alt="" className="size-[30px] rounded-pill" />}
            >
              Continue with Starshell
            </Button>
          </div>

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

        <p className="max-w-[246px] text-base font-semibold text-text-faint">
          <span className="text-text">
            Secret Network is a privacy preserving smart contract chain powered by the Cosmos stack.
          </span>
          <br />
          <br />
          Use and build dapps that value your privacy.
        </p>
      </div>
    </div>
  )
}

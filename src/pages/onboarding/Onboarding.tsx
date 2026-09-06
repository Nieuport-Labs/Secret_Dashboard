import { ArrowLeft, ArrowRight, ArrowUpRight, Check, Download } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

import Button from '@/components/ui/Button'
import { DISPLAY_DENOM } from '@/chains/secret4'
import { fetchDapps, WHERE_TO_BUY, type Dapp } from '@/lib/dapps'
import { isInstalled, WALLETS, type WalletId } from '@/lib/wallet'
import { cn } from '@/lib/cn'
import { useWallet } from '@/store/wallet'

const PROGRESS_KEY = 'secret-dashboard:onboarding-step'

/**
 * For someone who has not used Secret Network before.
 *
 * Five steps, in the order the questions actually arrive: how do I hold this,
 * what is the coin, why are there two versions of every token, what is there to
 * do, and how do I get some. Progress is kept locally so closing the tab does
 * not mean starting over.
 */
export default function Onboarding() {
  const navigate = useNavigate()
  const connected = useWallet((state) => state.status === 'connected')
  const connectWallet = useWallet((state) => state.connectWallet)
  const connecting = useWallet((state) => state.status === 'connecting')

  const [step, setStep] = useState(() => {
    try {
      return Number(localStorage.getItem(PROGRESS_KEY) ?? '0') || 0
    } catch {
      return 0
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(PROGRESS_KEY, String(step))
    } catch {
      // Resuming is a convenience, not a requirement.
    }
  }, [step])

  const steps: Array<{ title: string; body: ReactNode }> = [
    {
      title: 'Pick a wallet',
      body: <WalletStep connected={connected} connecting={connecting} onConnect={connectWallet} />
    },
    {
      title: `What ${DISPLAY_DENOM} is`,
      body: (
        <Prose>
          <p>
            {DISPLAY_DENOM} is the coin Secret Network runs on. Two things need it: paying for transactions,
            and staking, which is lending it to a validator in exchange for a share of newly issued coins.
          </p>
          <p>
            Every transaction costs a fraction of a {DISPLAY_DENOM}, which is why an account holding none
            cannot do anything at all — not even accept help. This dashboard works around that in two places:
            someone else can cover your fees with a grant, and bridging in can swap a slice of what you send
            into gas on the way.
          </p>
          <p>
            Unlike most chains, what your transaction <em>does</em> is encrypted. Anyone can see that you sent
            one and what it cost. What was in it is another matter.
          </p>
        </Prose>
      )
    },
    {
      title: 'Why tokens come in two versions',
      body: (
        <Prose>
          <p>
            A token bridged onto Secret arrives public: the amount and who holds it are readable by anyone,
            exactly as on the chain it came from. Wrapping it turns it into a SNIP-20, which is the same value
            held inside a contract that keeps balances encrypted.
          </p>
          <p>
            That is why this dashboard offers to wrap things as they arrive, and why the wallet screen calls
            them private tokens. Unwrapping goes back the other way whenever you need it.
          </p>
          <p>
            Reading your own private balance needs your signature rather than a password stored on chain.
            Older dashboards made you pay for a transaction first, to set what is called a viewing key. This
            one asks you to sign a permit instead, which costs nothing and writes nothing.
          </p>
        </Prose>
      )
    },
    { title: 'What there is to use', body: <DappsStep /> },
    {
      title: `Getting some ${DISPLAY_DENOM}`,
      body: (
        <div className="flex flex-col gap-4">
          <Prose>
            <p>
              Three ways, depending on what you already hold. Bridging is usually the cheapest if you have
              anything on another Cosmos chain.
            </p>
          </Prose>
          <ul className="flex flex-col gap-2">
            {WHERE_TO_BUY.map((place) => (
              <li key={place.name}>
                <a
                  href={place.link}
                  target={place.internal ? undefined : '_blank'}
                  rel={place.internal ? undefined : 'noreferrer noopener'}
                  className="state-layer block rounded-card bg-surface-1 p-4"
                >
                  <span className="flex items-center gap-1.5 text-base font-medium">
                    {place.name}
                    {!place.internal ? <ArrowUpRight size={14} aria-hidden /> : null}
                  </span>
                  <span className="mt-1 block text-sm text-text-muted">{place.detail}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )
    }
  ]

  const current = steps[Math.min(step, steps.length - 1)]
  const last = step >= steps.length - 1

  return (
    <div className="mx-auto flex max-w-[620px] flex-col gap-6">
      <div className="flex items-center gap-1.5" aria-label={`Step ${step + 1} of ${steps.length}`}>
        {steps.map((_, index) => (
          <span
            key={index}
            className={cn(
              'h-1 flex-1 rounded-pill transition-colors',
              index <= step ? 'bg-accent' : 'bg-surface'
            )}
          />
        ))}
      </div>

      <div>
        <p className="text-sm text-text-faint">
          Step {step + 1} of {steps.length}
        </p>
        <h1 className="mt-1 text-display">{current.title}</h1>
      </div>

      {current.body}

      <div className="flex items-center justify-between gap-3">
        <Button
          variant="ghost"
          size="sm"
          disabled={step === 0}
          icon={<ArrowLeft size={16} aria-hidden />}
          onClick={() => setStep((s) => Math.max(0, s - 1))}
        >
          Back
        </Button>

        <span className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => navigate('/wallet')}>
            Skip
          </Button>
          <Button
            variant="primary"
            trailing={last ? undefined : <ArrowRight size={16} aria-hidden />}
            onClick={() => (last ? navigate('/wallet') : setStep((s) => s + 1))}
          >
            {last ? 'Open my wallet' : 'Next'}
          </Button>
        </span>
      </div>
    </div>
  )
}

function Prose({ children }: { children: ReactNode }) {
  return <div className="flex max-w-[62ch] flex-col gap-3 text-base text-text-muted">{children}</div>
}

function WalletStep({
  connected,
  connecting,
  onConnect
}: {
  connected: boolean
  connecting: boolean
  onConnect: (id: WalletId) => Promise<void>
}) {
  return (
    <div className="flex flex-col gap-4">
      <Prose>
        <p>
          A wallet holds the key that signs for you. Neither this dashboard nor anyone else ever sees it. Both
          of these are browser extensions built for Secret Network.
        </p>
      </Prose>

      {connected ? (
        <p className="flex items-center gap-2 rounded-card bg-surface-1 p-4 text-base">
          <Check size={18} aria-hidden className="text-positive" />
          Connected. You can carry on.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {(['keplr', 'starshell'] as WalletId[]).map((id) => {
            const wallet = WALLETS[id]
            const installed = isInstalled(id)

            return (
              <li key={id} className="flex flex-wrap items-center gap-3 rounded-card bg-surface-1 px-4 py-3">
                <img src={wallet.icon} alt="" className="size-8 shrink-0 rounded-pill" />
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-medium">{wallet.name}</span>
                  <span className="block text-sm text-text-faint">
                    {installed ? 'Installed' : 'Not installed yet'}
                  </span>
                </span>
                {installed ? (
                  <Button
                    variant="soft"
                    shape="control"
                    size="sm"
                    loading={connecting}
                    onClick={() => void onConnect(id)}
                  >
                    Connect
                  </Button>
                ) : (
                  <a
                    href={wallet.installUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="state-layer flex items-center gap-1.5 rounded-control bg-surface px-3 py-1.5 text-sm"
                  >
                    <Download size={14} aria-hidden />
                    Install
                  </a>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/** Real apps from the registry, not a description of the idea of apps. */
function DappsStep() {
  const [dapps, setDapps] = useState<Dapp[]>([])

  useEffect(() => {
    let cancelled = false
    fetchDapps()
      .then((list) => {
        if (!cancelled) setDapps(list.slice(0, 6))
      })
      .catch(() => {
        /* the prose below still stands on its own */
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="flex flex-col gap-4">
      <Prose>
        <p>
          Applications on Secret can compute on data they are not allowed to read. That makes some things
          possible that are not elsewhere: sealed-bid auctions, private voting, messaging with no readable
          metadata.
        </p>
      </Prose>

      {dapps.length > 0 ? (
        <ul className="grid gap-2 sm:grid-cols-2">
          {dapps.map((dapp) => (
            <li key={dapp.name}>
              <a
                href={dapp.link}
                target="_blank"
                rel="noreferrer noopener"
                className="state-layer block h-full rounded-card bg-surface-1 p-3"
              >
                <span className="text-base font-medium">{dapp.name}</span>
                <span className="mt-0.5 block text-sm text-text-muted">{dapp.description}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

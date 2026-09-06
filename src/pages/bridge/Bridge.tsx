import {
  ArrowDown,
  ArrowLeftRight,
  ChevronDown,
  ExternalLink,
  Fuel,
  ShieldCheck,
  SlidersHorizontal
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import Button from '@/components/ui/Button'
import EmptyState from '@/components/ui/EmptyState'
import AmountField from '@/components/ui/AmountField'
import Picker from '@/components/ui/Picker'
import { DENOM, DISPLAY_DENOM, explorerTxUrl } from '@/chains/secret4'
import { SOURCE_CHAINS, chainImageUrl, type SourceChain } from '@/chains/sources'
import { depositGasLimit, sendDeposit, sendWithdraw, type Leg } from '@/lib/bridge'
import { queryAllBalances } from '@/lib/bank'
import { codeHashFor } from '@/lib/codeHash'
import { buildGasLeg, fittingGasSliceUsd, quoteGasSlice, shouldOfferGas } from '@/lib/getGas'
import { toBaseUnits } from '@/lib/format'
import { plainTransfer, wrapDepositMemo } from '@/lib/ibcMemo'
import { MSG_TRANSFER } from '@/lib/msgTypes'
import { fetchPrices } from '@/lib/prices'
import { cn } from '@/lib/cn'
import { useBalances } from '@/hooks/useBalances'
import { usePermit } from '@/hooks/usePermit'
import { useSourceWallet } from '@/hooks/useSourceWallet'
import {
  chainsWithDeposits,
  chainsWithWithdrawals,
  depositRoute,
  tokensFromChain,
  tokensToChain,
  withdrawRoute
} from '@/tokens/routes'
import { tokenByAddress, tokenImageUrl } from '@/tokens/registry'
import { transactionsCovered, useFeePayer } from '@/store/feePayer'
import { useSettings } from '@/store/settings'
import { useWallet } from '@/store/wallet'

type Status =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'done'; hash: string }
  | { kind: 'failed'; message: string }

type Direction = 'deposit' | 'withdraw'

/**
 * Moving tokens between Secret and the rest of IBC, both ways.
 *
 * The two directions share a form and are genuinely different transactions. A
 * deposit is signed on the *source* chain — a second wallet connection, the
 * same key under a different prefix — and can carry hooks, so the token arrives
 * already wrapped and a slice of it can become gas on the way. A withdrawal is
 * signed here on Secret, costs SCRT, and can therefore go through the app's fee
 * payer; it carries nothing, because there is no hook to run on the far side.
 */
export default function Bridge() {
  const navigate = useNavigate()
  const secretAddress = useWallet((state) => state.address)
  const queryClient = useWallet((state) => state.queryClient)
  const signingClient = useWallet((state) => state.client)
  const granterFor = useFeePayer((state) => state.granterFor)
  const settings = useSettings()
  const { permit } = usePermit()
  const balances = useBalances(permit)

  const [direction, setDirection] = useState<Direction>('deposit')
  const [chainId, setChainId] = useState<string | undefined>()
  const [tokenAddress, setTokenAddress] = useState<string | undefined>()
  const [amount, setAmount] = useState('')
  const [wrap, setWrap] = useState(settings.autoWrapDeposits)
  const [getGas, setGetGas] = useState(false)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [prices, setPrices] = useState<Map<string, number>>(new Map())
  const [secretBank, setSecretBank] = useState<Map<string, string>>(new Map())

  const depositing = direction === 'deposit'

  const chains = useMemo(() => {
    const ids = new Set(depositing ? chainsWithDeposits() : chainsWithWithdrawals())
    return SOURCE_CHAINS.filter((c) => ids.has(c.chainId))
  }, [depositing])

  const chain: SourceChain | undefined = chains.find((c) => c.chainId === chainId) ?? chains[0]

  const source = useSourceWallet(chain)

  const tokens = useMemo(
    () =>
      chain
        ? (depositing ? tokensFromChain(chain.chainId) : tokensToChain(chain.chainId))
            .map(tokenByAddress)
            .filter((t) => !!t)
        : [],
    [chain, depositing]
  )

  // Switching direction or chain can leave a token selected that this leg does
  // not carry, and the form would then describe a route that does not exist.
  useEffect(() => {
    if (!tokenAddress || !tokens.some((t) => t.address === tokenAddress)) {
      setTokenAddress(tokens[0]?.address)
    }
  }, [tokens, tokenAddress])

  const token = tokenAddress ? tokenByAddress(tokenAddress) : undefined
  const route =
    chain && tokenAddress
      ? depositing
        ? depositRoute(tokenAddress, chain.chainId)
        : withdrawRoute(tokenAddress, chain.chainId)
      : undefined

  useEffect(() => {
    const ids = ['secret', token?.coingeckoId].filter((id): id is string => !!id)
    void fetchPrices(ids)
      .then(setPrices)
      .catch(() => setPrices(new Map()))
  }, [token?.coingeckoId])

  /*
   * A withdrawal spends a *bank* denomination on Secret — `uscrt`, or the
   * `ibc/…` voucher the token arrived as. That is a different balance from the
   * SNIP-20 one on the wallet screen, and the difference is the whole reason a
   * wrapped token has to be unwrapped before it can leave.
   */
  useEffect(() => {
    if (depositing || !queryClient || !secretAddress) return
    let cancelled = false
    void queryAllBalances(queryClient, secretAddress)
      .then((held) => {
        if (!cancelled) setSecretBank(held)
      })
      .catch(() => {
        if (!cancelled) setSecretBank(new Map())
      })
    return () => {
      cancelled = true
    }
  }, [depositing, queryClient, secretAddress, status.kind])

  const decimals = token?.decimals ?? 6
  const available = depositing ? source.balance : route ? (secretBank.get(route.denom) ?? '0') : undefined

  let amountBaseUnits = '0'
  let amountError: string | undefined
  try {
    amountBaseUnits = amount ? toBaseUnits(amount, decimals) : '0'
  } catch (error) {
    amountError = error instanceof Error ? error.message : 'Not a number.'
  }
  if (!amountError && available !== undefined && BigInt(amountBaseUnits) > BigInt(available)) {
    amountError = 'More than you hold.'
  }

  const quote = quoteGasSlice({
    targetUsd: settings.gasSliceUsd,
    scrtPrice: prices.get('secret'),
    tokenPrice: token?.coingeckoId ? prices.get(token.coingeckoId) : undefined,
    tokenDecimals: decimals,
    bridgeAmountBaseUnits: amountBaseUnits
  })

  const gasOffer = depositing
    ? shouldOfferGas(balances.native, quote, amountBaseUnits)
    : ({ offer: false, reason: 'has-enough' } as const)
  /*
   * "Urgent" used to live entirely inside `gasOffer.urgent`, which is only set
   * when an offer is actually made. That made a wallet holding exactly zero
   * SCRT look identical to one holding plenty whenever the offer was blocked
   * for some other reason — amount-too-small chief among them, since a small
   * bridge is exactly what an empty wallet's first transfer tends to be. Read
   * the balance directly instead, so the panel can tell a genuinely empty
   * wallet from one that merely can't be offered a slice right now.
   */
  const walletEmpty = depositing && BigInt(balances.native ?? '0') === 0n
  const gasUrgent = gasOffer.offer && gasOffer.urgent
  const canGetGas = gasOffer.offer && Boolean(source.osmosisAddress)

  // An empty wallet is not a suggestion. The box starts ticked and the panel it
  // lives in starts open — hiding a precondition behind a disclosure is how
  // someone ends up bridged in and unable to sign anything.
  useEffect(() => {
    if (gasUrgent) {
      setGetGas(true)
      setOptionsOpen(true)
    }
  }, [gasUrgent])

  const reset = () => {
    setAmount('')
    setStatus({ kind: 'idle' })
  }

  const send = async () => {
    if (!chain || !route || !token || !secretAddress) return
    setStatus({ kind: 'sending' })

    try {
      if (depositing) {
        if (!source.address || !queryClient) return

        const useGas = getGas && canGetGas && gasOffer.offer
        const mainAmount = useGas
          ? (BigInt(amountBaseUnits) - BigInt(gasOffer.quote.costBaseUnits)).toString()
          : amountBaseUnits

        const legs: Leg[] = []

        // The main transfer, wrapped on arrival when asked. The code hash is
        // read from the chain: a stale one makes the hook fail and the tokens
        // land public instead, the opposite of what was asked for.
        legs.push({
          denom: route.denom,
          amount: mainAmount,
          channel: route.channel,
          transfer: wrap
            ? wrapDepositMemo(token.address, await codeHashFor(queryClient, token.address), secretAddress)
            : plainTransfer(secretAddress)
        })

        if (useGas && source.osmosisAddress) {
          legs.push({
            denom: route.denom,
            amount: gasOffer.quote.costBaseUnits,
            // Through Osmosis, not straight to Secret: that is where the swap is.
            channel: chain.chainId === 'osmosis-1' ? route.channel : undefined,
            transfer: buildGasLeg({
              secretAddress,
              osmosisAddress: source.osmosisAddress,
              delivery: settings.gasDelivery
            })
          })
        }

        const result = await sendDeposit({
          chain,
          sender: source.address,
          legs,
          gasLimit: depositGasLimit(chain, route, legs.length, wrap)
        })
        setStatus({ kind: 'done', hash: result.hash })
      } else {
        if (!signingClient || !source.address) return

        const result = await sendWithdraw({
          client: signingClient,
          chain,
          sender: secretAddress,
          receiver: source.address,
          denom: route.denom,
          amount: amountBaseUnits,
          channel: route.channel,
          feeGranter: granterFor(chain.withdrawGas, [MSG_TRANSFER])
        })
        setStatus({ kind: 'done', hash: result.hash })
      }
    } catch (error) {
      setStatus({ kind: 'failed', message: error instanceof Error ? error.message : String(error) })
    }
  }

  if (!secretAddress) {
    return (
      <EmptyState
        icon={ArrowLeftRight}
        title="Bridge tokens onto Secret"
        description="Move assets in from Cosmos Hub, Osmosis, Injective and the rest of IBC — wrapped on arrival if you want them private."
        action={<Button onClick={() => navigate('/wallet')}>Connect a wallet</Button>}
      />
    )
  }

  const secretSide = { label: 'Secret Network', image: '/img/secret-mark.svg' }
  const farSide = { label: chain?.name ?? '—', image: chain ? chainImageUrl(chain) : undefined }
  const from = depositing ? farSide : secretSide
  const to = depositing ? secretSide : farSide

  const needsAddress = !source.address

  return (
    <div className="mx-auto flex max-w-[520px] flex-col gap-10">
      <h1 className="text-display">Bridge</h1>

      {/* One panel, not a column of loose fields: everything inside decides a
          single transaction, and the shape should say so. */}
      <div className="card flex flex-col gap-6 p-5 sm:p-6">
        <Segmented
          value={direction}
          onChange={(next) => {
            setDirection(next)
            reset()
          }}
        />

        {/*
          The chain gets the full width. It used to share the row with a token
          field, which halved both and repeated the token — the amount row
          already shows which token this is, so that is where it is chosen.
        */}
        <section className="flex flex-col gap-3">
          <Field label={depositing ? 'From' : 'To'}>
            <Picker
              label="Network"
              options={chains.map((c) => ({
                id: c.chainId,
                label: c.name,
                detail: c.chainId,
                image: chainImageUrl(c)
              }))}
              value={chain?.chainId}
              onChange={(id) => {
                setChainId(id)
                reset()
              }}
            />
          </Field>

          <p className="flex flex-wrap items-center justify-center gap-2 text-label text-text-faint">
            {from.image ? <img src={from.image} alt="" className="size-4 rounded-pill" /> : null}
            {from.label}
            <ArrowDown size={13} aria-hidden className="-rotate-90" />
            {to.image ? <img src={to.image} alt="" className="size-4 rounded-pill" /> : null}
            {to.label}
          </p>
        </section>

        <AmountField
          amount={amount}
          onAmount={setAmount}
          symbol={token?.symbol}
          image={token ? tokenImageUrl(token) : undefined}
          available={available}
          decimals={decimals}
          error={amountError}
          options={tokens.map((t) => ({
            id: t.address,
            label: t.symbol,
            detail: t.description,
            image: tokenImageUrl(t)
          }))}
          value={tokenAddress}
          onSelect={(id) => {
            setTokenAddress(id)
            setAmount('')
          }}
        />

        {/*
          Options, not decisions. Both have a right default — wrap what arrives,
          and take a slice for gas only when there is no gas — so they are
          folded away rather than asked. The panel opens itself when the gas
          offer is urgent, because at zero SCRT it stops being an option.
        */}
        {depositing ? (
          <div className="flex flex-col gap-1">
            {/*
              No box around it. Everything on this form already belongs to one
              transaction and sits in one panel; drawing a second frame inside
              that panel says these two settings are a separate thing, which is
              the opposite of what they are. The chevron carries the affordance
              instead — with no border, it has to.
            */}
            <button
              type="button"
              onClick={() => setOptionsOpen((open) => !open)}
              aria-expanded={optionsOpen}
              className="state-layer -mx-2 flex items-center gap-2 rounded-control px-2 py-1.5 text-left text-base font-medium"
            >
              <SlidersHorizontal size={16} aria-hidden className="text-text-muted" />
              <span>Options</span>
              <ChevronDown
                size={14}
                aria-hidden
                className={cn(
                  'text-text-muted transition-transform duration-[var(--duration-short)] ease-[var(--ease-standard)]',
                  optionsOpen && 'rotate-180'
                )}
              />
              <span className="ml-auto text-label font-normal text-text-faint">
                {[wrap ? 'wrap on arrival' : undefined, getGas && canGetGas ? 'get gas' : undefined]
                  .filter(Boolean)
                  .join(' · ') || 'none'}
              </span>
            </button>

            {optionsOpen ? (
              <div className="-mx-2 flex flex-col gap-0.5">
                <Option
                  checked={wrap}
                  onChange={setWrap}
                  icon={<ShieldCheck size={16} aria-hidden className="text-accent" />}
                  title="Wrap on arrival"
                >
                  Arrives as a private SNIP-20 instead of sitting on Secret in public. Costs a little more gas
                  on the source chain.
                </Option>

                <Option
                  checked={getGas && canGetGas}
                  disabled={!canGetGas}
                  onChange={setGetGas}
                  highlight={gasUrgent || (walletEmpty && !gasOffer.offer)}
                  icon={
                    <Fuel
                      size={16}
                      aria-hidden
                      className={gasUrgent || walletEmpty ? 'text-accent' : undefined}
                    />
                  }
                  title={gasUrgent ? 'Get gas (recommended)' : 'Get gas'}
                >
                  {gasOffer.offer ? (
                    <>
                      {gasUrgent
                        ? `You hold no ${DISPLAY_DENOM}, so you could not sign anything on Secret — not even to buy gas. `
                        : ''}
                      {gasOffer.quote.amountScrt} {DISPLAY_DENOM} (about ${gasOffer.quote.usd?.toFixed(2)}) is
                      swapped out of this transfer on the way, through Osmosis — roughly{' '}
                      {transactionsCovered(BigInt(gasOffer.quote.amountBaseUnits)).toLocaleString()}{' '}
                      transactions.{' '}
                      <button
                        type="button"
                        onClick={() => settings.set('gasSliceUsd', Math.max(0.05, settings.gasSliceUsd / 4))}
                        className="underline underline-offset-4"
                      >
                        Take less
                      </button>
                      {!canGetGas ? (
                        <span className="mt-1 block text-text-faint">
                          Needs an Osmosis account in your wallet, for recovering the swap if it fails.
                        </span>
                      ) : null}
                    </>
                  ) : gasOffer.reason === 'amount-too-small' ? (
                    /*
                     * This is the case a genuinely empty wallet hits most
                     * often: their first transfer in is small, by definition,
                     * and the slice would have to eat an unreasonable share of
                     * it. The old copy here said "you are not [short of gas]"
                     * unconditionally — flatly false for exactly the person who
                     * most needs to see this row make sense. "Take less" is
                     * offered directly against a shrunk quote rather than the
                     * settings value alone, so the amount actually shown is one
                     * that would pass the ratio check, not just a smaller
                     * number that might still fail it.
                     */
                    <>
                      {walletEmpty
                        ? `You hold no ${DISPLAY_DENOM}, but this transfer is too small to safely take gas from — `
                        : 'This transfer is too small to safely take gas from — '}
                      taking ${settings.gasSliceUsd.toFixed(2)} would be a large share of it.{' '}
                      <button
                        type="button"
                        onClick={() =>
                          settings.set(
                            'gasSliceUsd',
                            fittingGasSliceUsd(
                              settings.gasSliceUsd,
                              prices.get('secret'),
                              token?.coingeckoId ? prices.get(token.coingeckoId) : undefined,
                              decimals,
                              amountBaseUnits
                            )
                          )
                        }
                        className="underline underline-offset-4"
                      >
                        Take less
                      </button>
                    </>
                  ) : gasOffer.reason === 'no-price' ? (
                    <>
                      {walletEmpty ? `You hold no ${DISPLAY_DENOM}. ` : ''}
                      Pricing for this token or for SCRT is unavailable right now, so the slice can&rsquo;t be
                      sized safely.
                    </>
                  ) : (
                    <>
                      Swaps about ${settings.gasSliceUsd.toFixed(2)} of this transfer into {DISPLAY_DENOM} on
                      the way, so you can pay for transactions once it lands. Offered when you are short of
                      gas — you are not.
                    </>
                  )}
                </Option>
              </div>
            ) : null}
          </div>
        ) : null}

        {status.kind === 'done' ? (
          <div className="flex flex-col gap-2 rounded-control border border-border bg-surface p-3">
            <p className="text-base">Sent. It usually lands within a minute.</p>
            <a
              className="inline-flex items-center gap-1.5 text-base text-accent underline underline-offset-4"
              href={explorerTxUrl(status.hash)}
              target="_blank"
              rel="noreferrer noopener"
            >
              View transaction
              <ExternalLink size={14} aria-hidden />
            </a>
          </div>
        ) : null}

        {status.kind === 'failed' ? (
          <p
            className="break-address rounded-control border border-border p-3 text-base text-negative"
            role="alert"
          >
            {status.message}
          </p>
        ) : null}

        {needsAddress ? (
          <Button variant="primary" block loading={source.connecting} onClick={() => void source.connect()}>
            {depositing
              ? `Connect on ${chain?.name ?? 'the source chain'}`
              : `Choose your ${chain?.name ?? 'destination'} address`}
          </Button>
        ) : (
          <Button
            variant="primary"
            block
            loading={status.kind === 'sending'}
            disabled={!route || !amount || Boolean(amountError) || BigInt(amountBaseUnits) === 0n}
            onClick={() => void send()}
          >
            {depositing ? 'Bridge to Secret' : `Send to ${chain?.name ?? 'destination'}`}
          </Button>
        )}

        {source.error ? (
          <p className="text-base text-negative" role="alert">
            {source.error}
          </p>
        ) : null}

        {/*
          A withdrawal spends the bank denomination, so a token held wrapped is
          invisible to it. Saying so where the zero appears beats leaving
          someone to conclude their balance has gone.
        */}
        {!depositing && available === '0' && token ? (
          <p className="text-label text-text-faint">
            This sends the public balance on Secret
            {route && route.denom !== DENOM ? ', which is the voucher it arrived as' : ''}. If you hold{' '}
            {token.symbol} wrapped,{' '}
            <button
              type="button"
              onClick={() => navigate('/wallet?panel=wrap')}
              className="text-accent underline underline-offset-4"
            >
              unwrap it first
            </button>
            .
          </p>
        ) : null}
      </div>
    </div>
  )
}

function Segmented({ value, onChange }: { value: Direction; onChange: (next: Direction) => void }) {
  return (
    <div role="tablist" className="flex gap-1 rounded-pill border border-border p-1">
      {(['deposit', 'withdraw'] as Direction[]).map((option) => (
        <button
          key={option}
          role="tab"
          type="button"
          aria-selected={value === option}
          onClick={() => onChange(option)}
          className={cn(
            'state-layer flex-1 rounded-pill px-4 py-1.5 text-base font-medium capitalize',
            'transition-colors duration-[var(--duration-short)] ease-[var(--ease-standard)]',
            value === option ? 'bg-accent-container text-accent' : 'text-text-muted'
          )}
        >
          {option}
        </button>
      ))}
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-label text-text-muted">{label}</span>
      {children}
    </div>
  )
}

function Option({
  checked,
  onChange,
  disabled,
  highlight,
  icon,
  title,
  children
}: {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  highlight?: boolean
  icon: ReactNode
  title: string
  children: ReactNode
}) {
  return (
    <label
      className={cn(
        'state-layer flex cursor-pointer items-start gap-3 rounded-control p-3',
        highlight && 'bg-accent-container',
        disabled && 'cursor-not-allowed opacity-60'
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-4 shrink-0 accent-[var(--color-accent)]"
      />
      <span className="min-w-0">
        <span className={cn('flex items-center gap-2 text-base font-medium', highlight && 'text-accent')}>
          {icon}
          {title}
        </span>
        <span className="mt-0.5 block text-label leading-relaxed text-text-muted">{children}</span>
      </span>
    </label>
  )
}

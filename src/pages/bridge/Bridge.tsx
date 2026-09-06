import { ArrowDown, ExternalLink, Fuel, Info, ShieldCheck } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import Button from '@/components/ui/Button'
import { DISPLAY_DENOM, explorerTxUrl } from '@/chains/secret4'
import { SOURCE_CHAINS, chainImageUrl, type SourceChain } from '@/chains/sources'
import { depositGasLimit, sendDeposit, type Leg } from '@/lib/bridge'
import { codeHashFor } from '@/lib/codeHash'
import { buildGasLeg, quoteGasSlice, shouldOfferGas } from '@/lib/getGas'
import { formatAmount, fromBaseUnits, toBaseUnits } from '@/lib/format'
import { plainTransfer, wrapDepositMemo } from '@/lib/ibcMemo'
import { fetchPrices } from '@/lib/prices'
import { cn } from '@/lib/cn'
import { useBalances } from '@/hooks/useBalances'
import { usePermit } from '@/hooks/usePermit'
import { useSourceWallet } from '@/hooks/useSourceWallet'
import { chainsWithDeposits, depositRoute, tokensFromChain } from '@/tokens/routes'
import { tokenByAddress, tokenImageUrl } from '@/tokens/registry'
import { transactionsCovered } from '@/store/feePayer'
import { useSettings } from '@/store/settings'
import { useWallet } from '@/store/wallet'

type Status =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'done'; hash: string }
  | { kind: 'failed'; message: string }

/**
 * Bringing tokens onto Secret.
 *
 * Two things happen here that do not happen on other bridges, and both are
 * about the state someone arrives in. Tokens are wrapped into their private
 * SNIP-20 as they land, rather than sitting on the chain in public. And if the
 * wallet has no SCRT, a slice of the transfer is swapped into some on the way,
 * because an account with no gas cannot even sign the transaction that would
 * get it gas.
 */
export default function Bridge() {
  const secretAddress = useWallet((state) => state.address)
  const queryClient = useWallet((state) => state.queryClient)
  const settings = useSettings()
  const { permit } = usePermit()
  const balances = useBalances(permit)

  const chains = useMemo(() => {
    const ids = new Set(chainsWithDeposits())
    return SOURCE_CHAINS.filter((chain) => ids.has(chain.chainId))
  }, [])

  const [chain, setChain] = useState<SourceChain | undefined>(chains[0])
  const [tokenAddress, setTokenAddress] = useState<string | undefined>()
  const [amount, setAmount] = useState('')
  const [wrap, setWrap] = useState(settings.autoWrapDeposits)
  const [getGas, setGetGas] = useState(false)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [prices, setPrices] = useState<Map<string, number>>(new Map())

  const source = useSourceWallet(chain)

  const tokens = useMemo(
    () =>
      chain
        ? tokensFromChain(chain.chainId)
            .map(tokenByAddress)
            .filter((t) => !!t)
        : [],
    [chain]
  )

  // Selecting a chain that does not carry the current token has to reset it,
  // or the form silently describes a route that does not exist.
  useEffect(() => {
    if (!tokenAddress || !tokens.some((t) => t.address === tokenAddress)) {
      setTokenAddress(tokens[0]?.address)
    }
  }, [tokens, tokenAddress])

  const token = tokenAddress ? tokenByAddress(tokenAddress) : undefined
  const route = chain && tokenAddress ? depositRoute(tokenAddress, chain.chainId) : undefined

  useEffect(() => {
    const ids = ['secret', token?.coingeckoId].filter((id): id is string => !!id)
    void fetchPrices(ids)
      .then(setPrices)
      .catch(() => setPrices(new Map()))
  }, [token?.coingeckoId])

  let amountBaseUnits = '0'
  let amountError: string | undefined
  try {
    amountBaseUnits = amount ? toBaseUnits(amount, token?.decimals ?? 6) : '0'
  } catch (error) {
    amountError = error instanceof Error ? error.message : 'Not a number.'
  }

  const quote = quoteGasSlice({
    targetUsd: settings.gasSliceUsd,
    scrtPrice: prices.get('secret'),
    tokenPrice: token?.coingeckoId ? prices.get(token.coingeckoId) : undefined,
    tokenDecimals: token?.decimals ?? 6,
    bridgeAmountBaseUnits: amountBaseUnits
  })

  const gasOffer = shouldOfferGas(balances.native, quote, amountBaseUnits)
  const gasUrgent = gasOffer.offer && gasOffer.urgent

  // An empty wallet is not a suggestion, so the box starts ticked there.
  useEffect(() => {
    if (gasUrgent) setGetGas(true)
  }, [gasUrgent])

  const canGetGas = gasOffer.offer && Boolean(source.osmosisAddress)

  const send = async () => {
    if (!chain || !route || !token || !secretAddress || !source.address || !queryClient) return

    setStatus({ kind: 'sending' })
    try {
      const useGas = getGas && canGetGas && gasOffer.offer
      const mainAmount = useGas
        ? (BigInt(amountBaseUnits) - BigInt(gasOffer.quote.costBaseUnits)).toString()
        : amountBaseUnits

      const legs: Leg[] = []

      // The main transfer, wrapped on arrival when asked. The code hash is read
      // from the chain: a stale one makes the hook fail and the tokens land
      // public instead, which is the opposite of what was asked for.
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
    } catch (error) {
      setStatus({ kind: 'failed', message: error instanceof Error ? error.message : String(error) })
    }
  }

  if (!secretAddress) {
    return <p className="text-base text-text-muted">Connect a wallet to bridge tokens onto Secret.</p>
  }

  return (
    <div className="mx-auto flex max-w-[560px] flex-col gap-6">
      <h1 className="text-display">Bridge</h1>

      <label className="flex flex-col gap-2">
        <span className="text-base font-medium">From</span>
        <select
          value={chain?.chainId ?? ''}
          onChange={(event) => setChain(chains.find((c) => c.chainId === event.target.value))}
          className="rounded-control bg-surface px-4 py-3 text-base outline-none"
        >
          {chains.map((c) => (
            <option key={c.chainId} value={c.chainId}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-2">
        <span className="text-base font-medium">Token</span>
        <select
          value={tokenAddress ?? ''}
          onChange={(event) => setTokenAddress(event.target.value)}
          className="rounded-control bg-surface px-4 py-3 text-base outline-none"
        >
          {tokens.map((t) => (
            <option key={t.address} value={t.address}>
              {t.symbol}
              {t.description ? ` — ${t.description}` : ''}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-2">
        <span className="flex items-center justify-between text-base font-medium">
          Amount
          {source.balance !== undefined ? (
            <button
              type="button"
              onClick={() => setAmount(fromBaseUnits(source.balance!, token?.decimals ?? 6))}
              className="state-layer rounded-control px-2 py-0.5 text-sm text-text-muted"
            >
              Balance {formatAmount(source.balance, { decimals: token?.decimals ?? 6 })}
            </button>
          ) : null}
        </span>
        <div className="flex items-center gap-3 rounded-control bg-surface px-4 py-3">
          {token ? <img src={tokenImageUrl(token)} alt="" className="size-6 rounded-pill" /> : null}
          <input
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="0.0"
            className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-text-faint"
          />
          <span className="shrink-0 text-base text-text-muted">{token?.symbol}</span>
        </div>
        {amountError ? (
          <span className="text-base text-negative" role="alert">
            {amountError}
          </span>
        ) : null}
      </label>

      <div className="flex items-center justify-center gap-2 text-text-faint">
        <ArrowDown size={18} aria-hidden />
        {chain ? <img src={chainImageUrl(chain)} alt="" className="size-4 rounded-pill opacity-60" /> : null}
        <span className="text-sm">Secret Network</span>
      </div>

      <label className="state-layer flex cursor-pointer items-start gap-3 rounded-control bg-surface p-3">
        <input
          type="checkbox"
          checked={wrap}
          onChange={(event) => setWrap(event.target.checked)}
          className="mt-1 size-4 shrink-0 accent-[var(--color-accent)]"
        />
        <span>
          <span className="flex items-center gap-2 text-base font-medium">
            <ShieldCheck size={16} aria-hidden className="text-accent" />
            Wrap on arrival
          </span>
          <span className="block text-sm text-text-muted">
            Arrives as a private SNIP-20 instead of sitting on Secret in public. Costs a little more gas on
            the source chain.
          </span>
        </span>
      </label>

      {gasOffer.offer ? (
        <label
          className={cn(
            'state-layer flex cursor-pointer items-start gap-3 rounded-control p-3',
            gasOffer.urgent ? 'bg-accent-container' : 'bg-surface'
          )}
        >
          <input
            type="checkbox"
            checked={getGas && canGetGas}
            disabled={!canGetGas}
            onChange={(event) => setGetGas(event.target.checked)}
            className="mt-1 size-4 shrink-0 accent-[var(--color-accent)]"
          />
          <span>
            <span
              className={cn(
                'flex items-center gap-2 text-base font-medium',
                gasOffer.urgent && 'text-accent'
              )}
            >
              <Fuel size={16} aria-hidden />
              Get gas {gasOffer.urgent ? '(recommended)' : ''}
            </span>
            <span className="block text-sm text-text-muted">
              {gasOffer.urgent
                ? `You hold no ${DISPLAY_DENOM}, so you could not sign anything on Secret — not even to buy gas. `
                : ''}
              {gasOffer.quote.amountScrt} {DISPLAY_DENOM} (about ${gasOffer.quote.usd?.toFixed(2)}) is swapped
              out of this transfer on the way, through Osmosis.
            </span>
            {/*
              Sizing the slice in dollars is only intuitive while SCRT is worth
              something like a dollar. At a cent it buys thousands of
              transactions, which is far more than anyone needs taken out of
              their transfer — so the count is shown next to the price, where it
              is impossible to miss and one tap from being changed.
            */}
            <span className="mt-1 block text-sm text-text-faint">
              Roughly {transactionsCovered(BigInt(gasOffer.quote.amountBaseUnits)).toLocaleString()}{' '}
              transactions.{' '}
              <button
                type="button"
                onClick={() => settings.set('gasSliceUsd', Math.max(0.05, settings.gasSliceUsd / 4))}
                className="underline underline-offset-4"
              >
                Take less
              </button>
            </span>
            {!canGetGas ? (
              <span className="mt-1 block text-sm text-text-faint">
                Needs an Osmosis account in your wallet, for recovering the swap if it fails.
              </span>
            ) : null}
          </span>
        </label>
      ) : null}

      {status.kind === 'done' ? (
        <div className="flex flex-col gap-3 rounded-card bg-surface-1 p-4">
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
        <p className="break-address rounded-card bg-surface-1 p-4 text-base text-negative" role="alert">
          {status.message}
        </p>
      ) : null}

      {!source.address ? (
        <Button variant="primary" block loading={source.connecting} onClick={() => void source.connect()}>
          Connect on {chain?.name ?? 'the source chain'}
        </Button>
      ) : (
        <Button
          variant="primary"
          block
          loading={status.kind === 'sending'}
          disabled={!route || !amount || Boolean(amountError) || BigInt(amountBaseUnits) === 0n}
          onClick={() => void send()}
        >
          Bridge to Secret
        </Button>
      )}

      {source.error ? (
        <p className="text-base text-negative" role="alert">
          {source.error}
        </p>
      ) : null}

      <p className="flex items-start gap-2 text-sm text-text-faint">
        <Info size={14} aria-hidden className="mt-0.5 shrink-0" />
        Assets that Axelar bridges in from Ethereum and other EVM chains are not offered: those routes were
        disabled after the June 2026 exploit. Axelar&rsquo;s own chain is a different thing, is listed above,
        and its IBC channel to Secret is open.
      </p>
    </div>
  )
}

import { CheckCircle2, ChevronDown, ExternalLink, Fuel } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import AmountHero from '@/components/ui/AmountHero'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { PickerDialog } from '@/components/ui/Picker'
import {
  DECIMALS,
  DENOM,
  DISPLAY_DENOM,
  GAS,
  GAS_PRICE_USCRT,
  GAS_VAULT_ADDRESS,
  explorerTxUrl
} from '@/chains/secret4'
import { usePermit } from '@/hooks/usePermit'
import { useBalances } from '@/hooks/useBalances'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'
import { formatAmount, toBaseUnits } from '@/lib/format'
import { PURCHASE_GAS, purchaseMessages, quoteForSscrt, swappableTokens } from '@/lib/gasPurchase'
import { buyGasCredit } from '@/lib/gasVault'
import { MSG_EXECUTE_CONTRACT } from '@/lib/msgTypes'
import { swapGas, swapMessage, type Quote } from '@/lib/shadeSwap'
import { permitAuth } from '@/lib/snip20'
import { broadcastTracked } from '@/lib/txProgress'
import { transactionsCovered, useFeePayer } from '@/store/feePayer'
import { useSettings } from '@/store/settings'
import { useWallet } from '@/store/wallet'
import { privateSymbol, SSCRT_ADDRESS, tokenByAddress, tokenImageUrl } from '@/tokens/registry'

interface Props {
  open: boolean
  onClose: () => void
}

const PRESETS = ['0.5', '1', '5']

/** Paying with public SCRT, straight from the bank balance. */
const NATIVE = 'native'

type Status =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'done'; hash: string }
  | { kind: 'failed'; message: string }

type QuoteState =
  { kind: 'none' } | { kind: 'loading' } | { kind: 'ready'; quote: Quote } | { kind: 'unavailable' }

/**
 * Buy gas credits from the vault contract.
 *
 * Paying SCRT in makes the contract issue this address a fee allowance of the
 * same size, payable from the contract rather than from the buyer's balance.
 * The point is that the allowance survives the buyer spending everything else.
 *
 * It can also be paid for with a private token, in the same one transaction
 * (`lib/gasPurchase.ts`): sSCRT is unwrapped into the purchase, and any other
 * SNIP-20 with a ShadeSwap route is swapped for sSCRT first. The amount is
 * always entered in credits; what that costs in the chosen token is quoted.
 */
export default function BuyCreditsModal({ open, onClose }: Props) {
  return (
    <Modal open={open} onClose={onClose} title="Buy gas credits">
      {/* Its own component so it mounts with the dialog: nothing is read, and
          no balance swept, while the dialog is closed. */}
      <BuyCredits onClose={onClose} />
    </Modal>
  )
}

function BuyCredits({ onClose }: { onClose: () => void }) {
  const address = useWallet((state) => state.address)
  const client = useWallet((state) => state.client)
  const queryClient = useWallet((state) => state.queryClient)
  const granterFor = useFeePayer((state) => state.granterFor)
  const refreshGrants = useFeePayer((state) => state.refresh)
  const { permit } = usePermit()
  const currency = useSettings((state) => state.currency)

  const [amount, setAmount] = useState('1')
  const [payWith, setPayWith] = useState<string>(NATIVE)
  const [picking, setPicking] = useState(false)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [swappable, setSwappable] = useState<string[]>([])
  const [quote, setQuote] = useState<QuoteState>({ kind: 'none' })

  // Which private tokens could pay, which needs the permit to read them at all.
  useEffect(() => {
    if (!queryClient || !permit) return
    let cancelled = false
    void swappableTokens(queryClient, permit)
      .then((tokens) => {
        if (!cancelled) setSwappable(tokens)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [queryClient, permit])

  const contracts = useMemo(() => [SSCRT_ADDRESS, ...swappable], [swappable])
  const balances = useBalances(permit ? permitAuth(permit) : undefined, undefined, contracts)

  const held = useMemo(() => {
    const map = new Map<string, bigint>()
    for (const row of balances.tokens) {
      if (row.outcome.status === 'ok' && BigInt(row.outcome.amount) > 0n) {
        map.set(row.token.address, BigInt(row.outcome.amount))
      }
    }
    return map
  }, [balances.tokens])

  let baseUnits: string | undefined
  let amountError: string | undefined
  try {
    baseUnits = toBaseUnits(amount)
    if (BigInt(baseUnits) === 0n) amountError = 'Enter an amount above zero.'
  } catch (error) {
    amountError = error instanceof Error ? error.message : 'Not a number.'
  }

  const swapping = payWith !== NATIVE && payWith !== SSCRT_ADDRESS
  const payToken = payWith === NATIVE ? undefined : tokenByAddress(payWith)
  const paySymbol = payToken ? privateSymbol(payToken) : DISPLAY_DENOM
  /** What is bought is credit, not SCRT — one credit pays one SCRT of fees. */
  const creditsUnit = amount === '1' ? 'gas credit' : 'gas credits'

  // The price moves, so the quote follows the amount, a moment after typing stops.
  useEffect(() => {
    if (!swapping || !queryClient || !baseUnits || amountError) {
      setQuote({ kind: 'none' })
      return
    }
    setQuote({ kind: 'loading' })
    let cancelled = false
    const timer = setTimeout(() => {
      void quoteForSscrt(queryClient, payWith, BigInt(baseUnits))
        .then((found) => {
          if (!cancelled) setQuote(found ? { kind: 'ready', quote: found } : { kind: 'unavailable' })
        })
        .catch(() => {
          if (!cancelled) setQuote({ kind: 'unavailable' })
        })
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [swapping, queryClient, payWith, baseUnits, amountError])

  // Why the chosen way of paying cannot cover this amount, if it cannot.
  let payError: string | undefined
  if (
    !amountError &&
    baseUnits &&
    payWith === SSCRT_ADDRESS &&
    BigInt(baseUnits) > (held.get(SSCRT_ADDRESS) ?? 0n)
  ) {
    payError = 'More sSCRT than you hold.'
  }
  if (!amountError && swapping) {
    if (quote.kind === 'unavailable')
      payError = 'ShadeSwap cannot fill this amount right now. Try a smaller one.'
    if (quote.kind === 'ready') {
      if (quote.quote.amountIn > (held.get(payWith) ?? 0n)) payError = `More ${paySymbol} than you hold.`
    }
  }

  const ready =
    Boolean(client && address && baseUnits) &&
    !amountError &&
    !payError &&
    (!swapping || quote.kind === 'ready')

  const buy = async () => {
    if (!client || !queryClient || !address || !baseUnits || !ready) return
    setStatus({ kind: 'sending' })
    try {
      let tx
      if (payWith === NATIVE) {
        tx = await buyGasCredit(
          client,
          GAS_VAULT_ADDRESS,
          address,
          // Buying for yourself. The contract accepts any grantee, which is what
          // lets someone else be sponsored, but that is not this screen's job.
          address,
          amount,
          granterFor(GAS.buyGasCredit, [MSG_EXECUTE_CONTRACT])
        )
      } else {
        const credits = BigInt(baseUnits)
        const route = swapping && quote.kind === 'ready' ? quote.quote : undefined
        // The swap promises `credits` of sSCRT at least; the unwrap and the
        // purchase then spend exactly that.
        const swap = route ? await swapMessage(address, route.route, route.amountIn, credits) : undefined
        const messages = await purchaseMessages(
          queryClient,
          address,
          { unwrap: credits, total: credits },
          swap
        )
        const gasLimit = PURCHASE_GAS + (route ? swapGas(route.route) : 0)
        tx = await broadcastTracked(
          { label: `Buy ${amount} ${creditsUnit}`, detail: `with ${paySymbol}` },
          client,
          messages,
          {
            gasLimit,
            gasPriceInFeeDenom: GAS_PRICE_USCRT,
            feeDenom: DENOM,
            feeGranter: granterFor(
              gasLimit,
              messages.map(() => MSG_EXECUTE_CONTRACT)
            )
          }
        )
      }

      if (tx.code !== 0) {
        setStatus({ kind: 'failed', message: tx.rawLog || `The chain rejected it (code ${tx.code}).` })
        return
      }

      setStatus({ kind: 'done', hash: tx.transactionHash })
      await refreshGrants()
    } catch (error) {
      setStatus({ kind: 'failed', message: errorMessage(error) })
    }
  }

  const covered = baseUnits && !amountError ? transactionsCovered(BigInt(baseUnits)) : 0

  // SCRT's price, for the money view of the amount: the wallet's own SCRT
  // already carries one, so no second price request.
  const scrtPrice =
    balances.native && balances.nativeFiat !== undefined && BigInt(balances.native) > 0n
      ? balances.nativeFiat / (Number(balances.native) / 10 ** DECIMALS)
      : undefined

  const options = [
    {
      id: NATIVE,
      label: DISPLAY_DENOM,
      detail:
        balances.native !== undefined
          ? `Balance ${formatAmount(balances.native)} · public`
          : 'Public balance',
      image: '/img/secret-mark.svg'
    },
    ...[SSCRT_ADDRESS, ...swappable]
      .filter((token) => held.has(token))
      .map((token) => {
        const info = tokenByAddress(token)
        return {
          id: token,
          label: info ? privateSymbol(info) : token,
          detail: `Balance ${formatAmount(held.get(token)!.toString(), { decimals: info?.decimals ?? 6 })}${
            token === SSCRT_ADDRESS ? ' · unwrapped' : ' · swapped on ShadeSwap'
          }`,
          image: info ? tokenImageUrl(info) : undefined
        }
      })
  ]
  const selected = options.find((option) => option.id === payWith) ?? options[0]
  // With a swap, what it costs in the token is the one thing worth reading
  // here, so it takes the place of the balance line.
  const payDetail = !swapping
    ? selected.detail
    : quote.kind === 'ready'
      ? `≈ ${formatAmount(quote.quote.amountIn.toString(), { decimals: payToken?.decimals ?? 6 })} ${paySymbol} · swapped on ShadeSwap`
      : quote.kind === 'loading'
        ? 'Getting a price…'
        : selected.detail

  if (status.kind === 'done') {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <CheckCircle2 size={18} aria-hidden className="mt-0.5 shrink-0 text-positive" />
          <p className="text-base">
            Bought {amount} {creditsUnit}. {amount === '1' ? 'It pays' : 'They pay'} for your next
            transactions automatically while your fee setting is Auto.
          </p>
        </div>
        <a
          className="inline-flex items-center gap-1.5 text-base text-accent underline underline-offset-4"
          href={explorerTxUrl(status.hash)}
          target="_blank"
          rel="noreferrer noopener"
        >
          View transaction
          <ExternalLink size={14} aria-hidden />
        </a>
        <Button variant="secondary" shape="control" onClick={onClose}>
          Done
        </Button>
      </div>
    )
  }

  return (
    <>
      {/* The amount, first and largest — the same card Send opens with. */}
      <div className="flex flex-col gap-4 rounded-card border border-border bg-surface p-4">
        <span className="text-label text-text-muted">You&rsquo;re buying</span>
        <AmountHero
          amount={amount}
          onAmount={setAmount}
          symbol="gas credits"
          decimals={DECIMALS}
          unitPrice={scrtPrice}
          currency={currency}
        />
        {/* Round amounts rather than a share of a balance: what is bought is
            credit, and the balance it comes out of depends on the token below. */}
        <div className="flex items-center justify-between gap-3">
          <span className="flex min-w-0 items-center gap-1.5 whitespace-nowrap text-label text-text-muted">
            <Fuel size={14} aria-hidden className="shrink-0" />
            {amountError ? 'Enter an amount' : `≈ ${covered} transactions`}
          </span>
          <div className="flex shrink-0 gap-1">
            {PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setAmount(preset)}
                className={cn(
                  'state-layer rounded-pill border border-border px-2.5 py-1 text-label font-medium',
                  amount === preset ? 'bg-accent-container text-accent' : 'text-text-muted'
                )}
              >
                {preset}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* What pays for it, as a row that is itself the picker — as in Send. */}
      <button
        type="button"
        onClick={() => setPicking(true)}
        aria-haspopup="dialog"
        className="state-layer -mt-2 flex items-center gap-3 rounded-card border border-border bg-surface px-4 py-3 text-left"
      >
        {selected.image ? <img src={selected.image} alt="" className="size-8 shrink-0 rounded-pill" /> : null}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-base font-medium">Pay with {selected.label}</span>
          <span className="truncate text-label text-text-faint">{payDetail}</span>
        </span>
        <ChevronDown size={16} aria-hidden className="shrink-0 text-text-muted" />
      </button>

      <PickerDialog
        open={picking}
        onClose={() => setPicking(false)}
        label="Pay with"
        options={options}
        value={payWith}
        onChange={(id) => setPayWith(id)}
      />

      {amountError || payError ? (
        <span className="-mt-2 text-base text-negative" role="alert">
          {amountError ?? payError}
        </span>
      ) : null}

      {status.kind === 'failed' ? (
        <p className="break-address text-base text-negative" role="alert">
          {status.message}
        </p>
      ) : null}

      <Button
        variant="primary"
        block
        size="lg"
        loading={status.kind === 'sending'}
        disabled={!ready}
        onClick={() => void buy()}
      >
        {!client ? 'Connect a wallet first' : !amount ? 'Enter an amount' : `Buy ${amount} ${creditsUnit}`}
      </Button>
    </>
  )
}

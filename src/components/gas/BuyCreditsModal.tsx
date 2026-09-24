import { ChevronDown, ExternalLink, Fuel } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { PickerDialog } from '@/components/ui/Picker'
import {
  DENOM,
  DISPLAY_DENOM,
  GAS,
  GAS_PRICE_USCRT,
  GAS_VAULT_ADDRESS,
  explorerTxUrl
} from '@/chains/secret4'
import { usePermit } from '@/hooks/usePermit'
import { useBalances } from '@/hooks/useBalances'
import { errorMessage } from '@/lib/errors'
import { formatAmount, toBaseUnits } from '@/lib/format'
import {
  MAX_IMPACT_BPS,
  PURCHASE_GAS,
  purchaseMessages,
  quoteForSscrt,
  swappableTokens
} from '@/lib/gasPurchase'
import { buyGasCredit, queryVaultStatus } from '@/lib/gasVault'
import { MSG_EXECUTE_CONTRACT } from '@/lib/msgTypes'
import { swapGas, swapMessage, type Quote } from '@/lib/shadeSwap'
import { permitAuth } from '@/lib/snip20'
import { broadcastTracked } from '@/lib/txProgress'
import { transactionsCovered, useFeePayer } from '@/store/feePayer'
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
    <Modal
      open={open}
      onClose={onClose}
      title="Buy gas credits"
      description="Pay in and the vault contract covers your transaction fees, from its balance rather than yours."
    >
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

  const [amount, setAmount] = useState('1')
  const [payWith, setPayWith] = useState<string>(NATIVE)
  const [picking, setPicking] = useState(false)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [vaultBalance, setVaultBalance] = useState<string | undefined>()
  const [swappable, setSwappable] = useState<string[]>([])
  const [quote, setQuote] = useState<QuoteState>({ kind: 'none' })

  // What the vault holds is also the sum of every allowance it has issued and
  // not seen spent, so this single figure says whether its grants are backed.
  useEffect(() => {
    if (!queryClient) return
    let cancelled = false
    void queryVaultStatus(queryClient, GAS_VAULT_ADDRESS)
      .then((s) => {
        if (!cancelled) setVaultBalance(s.balance)
      })
      .catch(() => {
        if (!cancelled) setVaultBalance(undefined)
      })
    return () => {
      cancelled = true
    }
  }, [queryClient])

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
      else if (quote.quote.impactBps > MAX_IMPACT_BPS) {
        payError = `This trade would move the price by ${(quote.quote.impactBps / 100).toFixed(1)}%. Try a smaller amount.`
      }
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
          { label: `Buy ${amount} ${DISPLAY_DENOM} of gas credit`, detail: `with ${paySymbol}` },
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

  const covered = baseUnits ? transactionsCovered(BigInt(baseUnits)) : 0

  const options = [
    { id: NATIVE, label: DISPLAY_DENOM, detail: 'Public balance' },
    ...[SSCRT_ADDRESS, ...swappable]
      .filter((token) => held.has(token))
      .map((token) => {
        const info = tokenByAddress(token)
        return {
          id: token,
          label: info ? privateSymbol(info) : token,
          detail: `${formatAmount(held.get(token)!.toString(), { decimals: info?.decimals ?? 6 })} held${
            token === SSCRT_ADDRESS ? '' : ' · swapped on ShadeSwap'
          }`,
          image: info ? tokenImageUrl(info) : undefined
        }
      })
  ]

  if (status.kind === 'done') {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-base">
          Bought {amount} {DISPLAY_DENOM} of credit. It applies to your next transaction automatically while
          your fee setting is Auto.
        </p>
        <a
          className="inline-flex items-center gap-1.5 text-base text-accent underline underline-offset-4"
          href={explorerTxUrl(status.hash)}
          target="_blank"
          rel="noreferrer noopener"
        >
          View transaction
          <ExternalLink size={14} aria-hidden />
        </a>
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <label htmlFor="credit-amount" className="text-base font-medium">
          Amount
        </label>
        <div className="flex items-center gap-2 rounded-control border border-border bg-surface px-3 py-2.5">
          <input
            id="credit-amount"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-text-faint"
            placeholder="0.0"
          />
          <span className="shrink-0 text-base text-text-muted">{DISPLAY_DENOM}</span>
        </div>
        <div className="flex gap-2">
          {PRESETS.map((preset) => (
            <Button key={preset} variant="soft" shape="control" size="sm" onClick={() => setAmount(preset)}>
              {preset}
            </Button>
          ))}
        </div>
        {amountError ? (
          <p className="text-base text-negative" role="alert">
            {amountError}
          </p>
        ) : (
          <p className="flex items-center gap-2 text-base text-text-muted">
            <Fuel size={16} aria-hidden />
            Roughly {covered} transactions
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-base font-medium">Pay with</span>
        <button
          type="button"
          onClick={() => setPicking(true)}
          aria-haspopup="dialog"
          className="state-layer flex items-center gap-2 rounded-control border border-border bg-surface px-3 py-2.5 text-left"
        >
          {payToken ? (
            <img src={tokenImageUrl(payToken)} alt="" className="size-5 shrink-0 rounded-pill" />
          ) : null}
          <span className="min-w-0 flex-1 text-base">{paySymbol}</span>
          <ChevronDown size={14} aria-hidden className="text-text-muted" />
        </button>
        {!permit ? (
          <p className="text-sm text-text-faint">
            Sign the query permit (in Settings) to pay with a private token.
          </p>
        ) : null}
        {swapping && !amountError ? (
          <p className="text-sm text-text-muted">
            {quote.kind === 'loading'
              ? 'Getting a price from ShadeSwap…'
              : quote.kind === 'ready'
                ? `About ${formatAmount(quote.quote.amountIn.toString(), {
                    decimals: payToken?.decimals ?? 6
                  })} ${paySymbol}, swapped for sSCRT and unwrapped into the purchase — all in one transaction. At most 1% worse, or it does not go through.`
                : null}
          </p>
        ) : null}
        {payWith === SSCRT_ADDRESS ? (
          <p className="text-sm text-text-muted">Unwrapped into the purchase in the same transaction.</p>
        ) : null}
        {payError ? (
          <p className="text-base text-negative" role="alert">
            {payError}
          </p>
        ) : null}
      </div>

      <PickerDialog
        open={picking}
        onClose={() => setPicking(false)}
        label="Pay with"
        options={options}
        value={payWith}
        onChange={(id) => setPayWith(id)}
      />

      <dl className="flex flex-col gap-1 text-base">
        <div className="flex justify-between gap-4">
          <dt className="text-text-muted">Vault balance</dt>
          <dd>
            {vaultBalance === undefined ? 'Unavailable' : `${formatAmount(vaultBalance)} ${DISPLAY_DENOM}`}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-text-muted">Network fee for this purchase</dt>
          <dd>paid separately</dd>
        </div>
      </dl>

      {/* Both of these are ways people lose track of what a grant does. */}
      <p className="text-sm text-text-faint">
        Credits pay fees only. They are not a token, cannot be sent on, and a private SNIP-20 token cannot pay
        gas on this chain in the first place — which is why one is turned into SCRT on the way in.
      </p>

      {status.kind === 'failed' ? (
        <p className="break-address text-base text-negative" role="alert">
          {status.message}
        </p>
      ) : null}

      <Button
        variant="primary"
        block
        loading={status.kind === 'sending'}
        disabled={!ready}
        onClick={() => void buy()}
      >
        {client ? 'Buy credits' : 'Connect a wallet first'}
      </Button>
    </div>
  )
}

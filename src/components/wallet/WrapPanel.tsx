import { ArrowDown, CheckCircle2, ExternalLink } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import AmountField from '@/components/ui/AmountField'
import Button from '@/components/ui/Button'
import Drawer from '@/components/ui/Drawer'
import { DENOM, DISPLAY_DENOM, explorerTxUrl } from '@/chains/secret4'
import { queryAllBalances } from '@/lib/bank'
import { cn } from '@/lib/cn'
import { toBaseUnits } from '@/lib/format'
import type { Balances } from '@/hooks/useBalances'
import { useWalletActions } from '@/hooks/useWalletActions'
import { bankDenomFor } from '@/tokens/routes'
import { SSCRT_ADDRESS, TOKENS, tokenByAddress, tokenImageUrl } from '@/tokens/registry'
import { useWallet } from '@/store/wallet'

interface Props {
  open: boolean
  onClose: () => void
  balances: Balances
  /** Preselected by the "you just received X — wrap it?" toast. */
  token?: string
}

type Direction = 'wrap' | 'unwrap'

/**
 * Wrapping and unwrapping, which are the same pair of contract calls in both
 * directions and so share one panel.
 *
 * Wrapping puts a public bank balance inside its SNIP-20 contract, where the
 * amount and the holder stop being readable. Unwrapping takes it back out. The
 * asset list is every token whose underlying denomination on Secret can be
 * named without guessing — see `bankDenomFor`.
 */
export default function WrapPanel({ open, onClose, balances, token: requested }: Props) {
  const queryClient = useWallet((state) => state.queryClient)
  const address = useWallet((state) => state.address)
  const actions = useWalletActions(balances.refresh)

  const [direction, setDirection] = useState<Direction>('wrap')
  const [contract, setContract] = useState(SSCRT_ADDRESS)
  const [amount, setAmount] = useState('')
  const [bank, setBank] = useState<Map<string, string>>(new Map())

  /** Tokens whose bank denomination is unambiguous, so a wrap knows what to spend. */
  const wrappable = useMemo(
    () => TOKENS.map((token) => ({ token, denom: bankDenomFor(token.address) })).filter((row) => row.denom),
    []
  )

  useEffect(() => {
    if (!open) return
    setAmount('')
    actions.reset()
    if (requested && wrappable.some((row) => row.token.address === requested)) setContract(requested)
    // Only when the panel opens; `actions` is rebuilt on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, requested])

  // The public side of the pair. It is not in `useBalances`, which reads the
  // native denomination and the SNIP-20 contracts but not the IBC vouchers
  // sitting in the bank module — and a voucher is exactly what a wrap spends.
  useEffect(() => {
    if (!open || !queryClient || !address) return
    let cancelled = false
    void queryAllBalances(queryClient, address)
      .then((held) => {
        if (!cancelled) setBank(held)
      })
      .catch(() => {
        if (!cancelled) setBank(new Map())
      })
    return () => {
      cancelled = true
    }
  }, [open, queryClient, address, actions.state.kind])

  const token = tokenByAddress(contract)
  const denom = bankDenomFor(contract)
  const decimals = token?.decimals ?? 6
  const wrapping = direction === 'wrap'

  const wrapped = balances.tokens.find((row) => row.token.address === contract)
  const wrappedAmount = wrapped?.outcome.status === 'ok' ? wrapped.outcome.amount : undefined
  const publicAmount = denom === DENOM ? balances.native : denom ? (bank.get(denom) ?? '0') : undefined

  const available = wrapping ? publicAmount : wrappedAmount

  let base = '0'
  let amountError: string | undefined
  try {
    base = amount ? toBaseUnits(amount, decimals) : '0'
  } catch (error) {
    amountError = error instanceof Error ? error.message : 'Not a number.'
  }
  if (!amountError && available !== undefined && BigInt(base) > BigInt(available)) {
    amountError = 'More than you hold.'
  }

  /*
   * Wrapping every last uscrt leaves nothing to pay the fee with, and the next
   * thing the user tries then fails for a reason that looks unrelated. Only
   * SCRT itself has this problem: it is the only denomination that pays gas.
   */
  const spendingGas = wrapping && denom === DENOM
  const wouldStrandGas =
    spendingGas && publicAmount !== undefined && BigInt(publicAmount) - BigInt(base) < 100_000n

  const ready = Boolean(amount) && !amountError && BigInt(base) > 0n && Boolean(denom)

  const submit = () => {
    if (!ready || !denom) return
    if (wrapping) void actions.wrap(contract, denom, base)
    else void actions.unwrap(contract, base)
  }

  const publicLabel = denom === DENOM ? DISPLAY_DENOM : (token?.symbol ?? 'token')
  const privateLabel = token ? `s${token.symbol}` : 'wrapped'

  return (
    <Drawer open={open} onClose={onClose} title="Wrap">
      {actions.state.kind === 'done' ? (
        <Receipt
          hash={actions.state.hash}
          onAgain={() => {
            setAmount('')
            actions.reset()
          }}
        />
      ) : (
        <>
          <div role="tablist" className="flex gap-1 rounded-pill border border-border p-1">
            {(['wrap', 'unwrap'] as Direction[]).map((option) => (
              <button
                key={option}
                role="tab"
                type="button"
                aria-selected={direction === option}
                onClick={() => {
                  setDirection(option)
                  setAmount('')
                  actions.reset()
                }}
                className={cn(
                  'state-layer flex-1 rounded-pill px-4 py-1.5 text-base font-medium capitalize',
                  'transition-colors duration-[var(--duration-short)] ease-[var(--ease-standard)]',
                  direction === option ? 'bg-accent-container text-accent' : 'text-text-muted'
                )}
              >
                {option}
              </button>
            ))}
          </div>

          <AmountField
            amount={amount}
            onAmount={setAmount}
            symbol={wrapping ? publicLabel : privateLabel}
            image={token ? tokenImageUrl(token) : undefined}
            available={available}
            decimals={decimals}
            error={amountError}
            options={wrappable.map(({ token: option }) => ({
              id: option.address,
              label: option.symbol,
              detail: option.description,
              image: tokenImageUrl(option)
            }))}
            optionsLabel="Token"
            value={contract}
            onSelect={(id) => {
              setContract(id)
              setAmount('')
            }}
          />

          <p className="flex items-center justify-center gap-2 text-label text-text-faint">
            {wrapping ? publicLabel : privateLabel}
            <ArrowDown size={13} aria-hidden className="-rotate-90" />
            {wrapping ? privateLabel : publicLabel}
          </p>

          <p className="text-label text-text-muted">
            {wrapping
              ? `Held inside the contract, the balance and every transfer of it are encrypted. Reading your own needs the query permit you have already signed — no viewing key, no transaction.`
              : `Unwrapping puts it back in the bank module, where the balance is public again. That is what an IBC transfer out of Secret spends.`}
          </p>

          {wouldStrandGas ? (
            <p className="text-label text-negative" role="alert">
              That leaves too little {DISPLAY_DENOM} to pay for a transaction — including the one that would
              unwrap it. Keep a little back, or use a gas grant.
            </p>
          ) : null}

          {actions.state.kind === 'failed' ? (
            <p className="break-address text-base text-negative" role="alert">
              {actions.state.message}
            </p>
          ) : null}

          <Button
            variant="primary"
            block
            size="lg"
            loading={actions.state.kind === 'sending'}
            disabled={!ready}
            onClick={submit}
          >
            {wrapping ? `Wrap ${publicLabel}` : `Unwrap ${privateLabel}`}
          </Button>
        </>
      )}
    </Drawer>
  )
}

function Receipt({ hash, onAgain }: { hash: string; onAgain: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <CheckCircle2 size={18} aria-hidden className="mt-0.5 shrink-0 text-positive" />
        <p className="text-base">Done.</p>
      </div>
      <a
        className="inline-flex items-center gap-1.5 text-base text-accent underline underline-offset-4"
        href={explorerTxUrl(hash)}
        target="_blank"
        rel="noreferrer noopener"
      >
        View transaction
        <ExternalLink size={14} aria-hidden />
      </a>
      <Button variant="secondary" shape="control" onClick={onAgain}>
        Wrap something else
      </Button>
    </div>
  )
}

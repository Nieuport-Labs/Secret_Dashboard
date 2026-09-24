import { CheckCircle2, Clock, ExternalLink } from 'lucide-react'
import { useEffect, useState } from 'react'

import AmountField from '@/components/ui/AmountField'
import Button from '@/components/ui/Button'
import Drawer from '@/components/ui/Drawer'
import { DISPLAY_DENOM, explorerTxUrl } from '@/chains/secret4'
import type { Balances } from '@/hooks/useBalances'
import type { Derivative } from '@/hooks/useDerivative'
import { useWalletActions } from '@/hooks/useWalletActions'
import { scrtValueOf } from '@/lib/derivative'
import { formatDisplayAmount, toBaseUnits } from '@/lib/format'
import { tokenByAddress, tokenImageUrl, STKD_SCRT_ADDRESS } from '@/tokens/registry'

interface Props {
  open: boolean
  onClose: () => void
  balances: Balances
  derivative: Derivative
  onDone: () => void
}

/**
 * Leaving stkd-SCRT: unbonding, and claiming what has come out the other end.
 *
 * Both in one panel because they are the two ends of a single wait, and because
 * claiming has no amount to choose — as a panel of its own it would be a button
 * on an empty sheet. Whichever of the two the row's menu asked for, the other
 * is here too, which is how someone who came to unbond notices that the SCRT
 * from last month is sitting there waiting.
 */
export default function UnstakePanel({ open, onClose, balances, derivative, onDone }: Props) {
  const actions = useWalletActions(onDone)
  const [amount, setAmount] = useState('')

  const token = tokenByAddress(STKD_SCRT_ADDRESS)
  const decimals = token?.decimals ?? 6

  const held = balances.tokens.find((row) => row.token.address === STKD_SCRT_ADDRESS)
  const available = held?.outcome.status === 'ok' ? held.outcome.amount : undefined

  useEffect(() => {
    if (!open) return
    setAmount('')
    actions.reset()
    // Only when the panel opens; `actions` is rebuilt on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

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

  const price = derivative.info?.price
  const worth = price && !amountError ? scrtValueOf(base, price) : undefined
  const claimable = BigInt(derivative.claimable)
  const ready = Boolean(amount) && !amountError && BigInt(base) > 0n

  const days = derivative.info ? Math.round(derivative.info.unbondingSeconds / 86_400) : 21

  return (
    <Drawer open={open} onClose={onClose} title="Unstake">
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
          {/* Above the form, not below it: money already waiting outranks money
              someone is about to start waiting for. */}
          {claimable > 0n ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-surface px-4 py-3">
              {/* Green, like the row in the wallet list it echoes. The accent
                  container was saying "careful" about money that has arrived. */}
              <p className="text-base">
                <span className="text-positive">{formatDisplayAmount(derivative.claimable)} </span>
                {DISPLAY_DENOM} ready to claim
              </p>
              <Button
                variant="soft"
                shape="control"
                size="sm"
                loading={actions.state.kind === 'sending'}
                onClick={() => void actions.claimDerivative()}
              >
                Claim
              </Button>
            </div>
          ) : null}

          <AmountField
            amount={amount}
            onAmount={setAmount}
            symbol="stkd-SCRT"
            image={token ? tokenImageUrl(token) : undefined}
            available={available}
            decimals={decimals}
            error={amountError}
          />

          <div className="flex flex-col gap-1.5">
            <p className="flex items-center justify-between gap-4 text-base">
              <span className="text-text-muted">You get back</span>
              <span className="tabular-nums">
                {worth === undefined ? '—' : `≈ ${formatDisplayAmount(worth)} ${DISPLAY_DENOM}`}
              </span>
            </p>
            {/*
              "≈" is not modesty about rounding. The derivative's price moves
              with the rewards it collects, so the figure is worth more by the
              time it lands, and Shade takes a withdraw fee at unbonding whose
              scale the contract does not publish. Naming an exact number here
              would be inventing one.
            */}
            <p className="text-label text-text-faint">
              At today&rsquo;s rate, before Shade&rsquo;s withdraw fee. The position keeps earning while it
              unbonds.
            </p>
          </div>

          <div className="flex items-start gap-3 rounded-card bg-surface px-4 py-3">
            <Clock size={16} aria-hidden className="mt-0.5 shrink-0 text-text-muted" />
            <div className="flex flex-col gap-1">
              <p className="text-base">Roughly {days} days, and not a moment sooner.</p>
              <p className="text-label text-text-muted">
                Requests leave in batches — the contract may hold only a few unbonding delegations at once for
                all of its users — so yours waits for the next batch
                {derivative.info?.nextBatchAt ? ` (${derivative.info.nextBatchAt.toLocaleString()})` : ''} and
                then for the chain&rsquo;s {days} days. Selling stkd-SCRT on a market is the instant way out;
                this is the one that needs no counterparty.
              </p>
            </div>
          </div>

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
            onClick={() => void actions.unbondDerivative(base, { label: `Unstake ${amount} stkd-SCRT` })}
          >
            Unstake stkd-SCRT
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
        <p className="text-base">Done. The wallet list shows where it is in the queue.</p>
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
        Back
      </Button>
    </div>
  )
}

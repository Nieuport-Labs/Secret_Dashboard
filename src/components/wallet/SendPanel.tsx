import { CheckCircle2, ExternalLink, Eye, ShieldCheck } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import AmountField from '@/components/ui/AmountField'
import Button from '@/components/ui/Button'
import Drawer from '@/components/ui/Drawer'
import { DENOM, DISPLAY_DENOM, explorerTxUrl } from '@/chains/secret4'
import { isValidBech32 } from '@/lib/bech32'
import { toBaseUnits } from '@/lib/format'
import type { Balances } from '@/hooks/useBalances'
import { useWalletActions } from '@/hooks/useWalletActions'
import { tokenImageUrl, type TokenInfo } from '@/tokens/registry'

interface Props {
  open: boolean
  onClose: () => void
  balances: Balances
}

/** The native denomination, given the same shape as a token so one list holds both. */
const NATIVE_ID = 'native'

/**
 * Sending, from the panel rather than a page of its own.
 *
 * Native and SNIP-20 sit in one list because from here they are the same task,
 * but they are not the same transaction and the difference is the one thing
 * worth saying out loud: a bank transfer is public and a SNIP-20 transfer is
 * not. That is the reason most of these tokens exist, so the form says which
 * one is about to happen.
 */
export default function SendPanel({ open, onClose, balances }: Props) {
  const actions = useWalletActions(balances.refresh)

  const [assetId, setAssetId] = useState(NATIVE_ID)
  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('')

  // A panel that reopens showing the last transfer's receipt is a panel that
  // looks like it is about to send it again.
  useEffect(() => {
    if (!open) return
    setRecipient('')
    setAmount('')
    actions.reset()
    // Only when the panel opens; `actions` is rebuilt on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const held = useMemo(
    () =>
      balances.tokens
        .filter((row) => row.outcome.status === 'ok' && BigInt(row.outcome.amount) > 0n)
        .map((row) => ({ token: row.token, amount: row.outcome.status === 'ok' ? row.outcome.amount : '0' })),
    [balances.tokens]
  )

  const options = [
    {
      id: NATIVE_ID,
      label: DISPLAY_DENOM,
      detail: 'Public — visible to anyone',
      image: '/img/secret-mark.svg'
    },
    ...held.map(({ token }) => ({
      id: token.address,
      label: token.symbol,
      detail: token.description ?? 'Private SNIP-20',
      image: tokenImageUrl(token)
    }))
  ]

  const isNative = assetId === NATIVE_ID
  const selected: TokenInfo | undefined = held.find((row) => row.token.address === assetId)?.token
  const decimals = isNative ? 6 : (selected?.decimals ?? 6)
  const symbol = isNative ? DISPLAY_DENOM : selected?.symbol
  const image = isNative ? '/img/secret-mark.svg' : selected ? tokenImageUrl(selected) : undefined
  const available = isNative ? balances.native : held.find((row) => row.token.address === assetId)?.amount

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

  const trimmed = recipient.trim()
  const recipientError =
    trimmed.length === 0 || isValidBech32(trimmed, 'secret')
      ? undefined
      : trimmed.startsWith('secret1')
        ? 'That address fails its checksum — a character is wrong.'
        : `Not a Secret address. It starts with "secret1".`

  const ready = Boolean(trimmed) && !recipientError && Boolean(amount) && !amountError && BigInt(base) > 0n

  const submit = () => {
    if (!ready) return
    if (isNative) void actions.sendNative(trimmed, base, DENOM)
    else void actions.sendToken(assetId, trimmed, base)
  }

  return (
    <Drawer open={open} onClose={onClose} title="Send">
      {actions.state.kind === 'done' ? (
        <Receipt
          hash={actions.state.hash}
          onAgain={() => {
            setAmount('')
            setRecipient('')
            actions.reset()
          }}
        />
      ) : (
        <>
          <label className="flex flex-col gap-1.5">
            <span className="text-label text-text-muted">To</span>
            <input
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
              placeholder="secret1…"
              spellCheck={false}
              autoComplete="off"
              className="break-address rounded-control border border-border bg-surface px-3 py-2.5 font-mono text-sm outline-none placeholder:text-text-faint"
            />
            {recipientError ? (
              <span className="text-label text-negative" role="alert">
                {recipientError}
              </span>
            ) : null}
          </label>

          <AmountField
            amount={amount}
            onAmount={setAmount}
            symbol={symbol}
            image={image}
            available={available}
            decimals={decimals}
            error={amountError}
            options={options}
            optionsLabel="Asset"
            value={assetId}
            onSelect={(id) => {
              setAssetId(id)
              setAmount('')
            }}
          />

          {/*
            Which of the two transactions this is. Someone reaching for a
            private token and getting a public bank transfer has lost the only
            property they came for, and there is nothing after the fact to undo
            it — so it is stated before the button, not after.
          */}
          <p className="flex items-start gap-2 text-label text-text-muted">
            {isNative ? (
              <>
                <Eye size={14} aria-hidden className="mt-px shrink-0" />
                {DISPLAY_DENOM} moves through the bank module, so the amount and both addresses are public.
                Wrap it first if this transfer should not be.
              </>
            ) : (
              <>
                <ShieldCheck size={14} aria-hidden className="mt-px shrink-0 text-accent" />A SNIP-20 transfer
                is encrypted. The chain records that you called the contract, not who was paid or how much.
              </>
            )}
          </p>

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
            Send {symbol}
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
        <p className="text-base">Sent.</p>
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
        Send something else
      </Button>
    </div>
  )
}

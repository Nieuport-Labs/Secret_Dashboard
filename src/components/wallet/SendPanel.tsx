import { CheckCircle2, ExternalLink, Eye, ShieldCheck } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import AmountField from '@/components/ui/AmountField'
import Button from '@/components/ui/Button'
import Drawer from '@/components/ui/Drawer'
import { DECIMALS, DENOM, DISPLAY_DENOM, explorerTxUrl } from '@/chains/secret4'
import { isValidBech32 } from '@/lib/bech32'
import { toBaseUnits } from '@/lib/format'
import type { Balances } from '@/hooks/useBalances'
import { useWalletActions } from '@/hooks/useWalletActions'
import { privateSymbol, tokenImageUrl } from '@/tokens/registry'

interface Props {
  open: boolean
  onClose: () => void
  balances: Balances
  /** Preselected by the row the send was started from. */
  asset?: string
  /** Called once a transaction lands, so every list of this account refreshes. */
  onDone: () => void
}

/** The native denomination, given the same shape as a token so one list holds both. */
const NATIVE_ID = 'native'

/** One thing that can be sent, however it is actually held. */
interface Sendable {
  id: string
  symbol: string
  detail: string
  image?: string
  /** Base units. */
  amount: string
  decimals: number
  private: boolean
  /** Bank denomination, on the public ones. */
  denom?: string
}

/**
 * Sending, from the panel rather than a page of its own.
 *
 * Public and private sit in one list because from here they are the same task,
 * but they are not the same transaction and the difference is the one thing
 * worth saying out loud: a bank transfer is public and a SNIP-20 transfer is
 * not. That is the reason most of these tokens exist, so the form says which
 * one is about to happen.
 */
export default function SendPanel({ open, onClose, balances, asset, onDone }: Props) {
  const actions = useWalletActions(onDone)

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
    if (asset) setAssetId(asset)
    // Only when the panel opens; `actions` is rebuilt on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, asset])

  const sendable = useMemo<Sendable[]>(() => {
    const rows: Sendable[] = []

    /*
     * Public holdings, native first. A voucher no registry entry claims is left
     * out: its decimal places are not knowable from the denomination, and a
     * form that scales the typed amount by a guess sends the wrong number. It
     * still shows on the wallet screen — it is the account's money — it just
     * cannot be given a figure to multiply here.
     */
    for (const held of balances.publicBalances) {
      const native = held.denom === DENOM
      if (!native && !held.token) continue
      rows.push({
        id: native ? NATIVE_ID : `bank:${held.denom}`,
        symbol: native ? DISPLAY_DENOM : held.token!.symbol,
        detail: 'Public — visible to anyone',
        image: native ? '/img/secret-mark.svg' : tokenImageUrl(held.token!),
        amount: held.amount,
        decimals: native ? DECIMALS : held.token!.decimals,
        private: false,
        denom: held.denom
      })
    }

    for (const row of balances.tokens) {
      if (row.outcome.status !== 'ok' || BigInt(row.outcome.amount) === 0n) continue
      rows.push({
        id: row.token.address,
        symbol: privateSymbol(row.token),
        detail: row.token.description ?? 'Private SNIP-20',
        image: tokenImageUrl(row.token),
        amount: row.outcome.amount,
        decimals: row.token.decimals,
        private: true
      })
    }

    return rows
  }, [balances.publicBalances, balances.tokens])

  const options = sendable.map((row) => ({
    id: row.id,
    label: row.symbol,
    detail: row.detail,
    image: row.image
  }))

  const selected = sendable.find((row) => row.id === assetId) ?? sendable[0]
  const isPrivate = selected?.private ?? false
  const decimals = selected?.decimals ?? DECIMALS
  const symbol = selected?.symbol ?? DISPLAY_DENOM
  const image = selected?.image
  const available = selected?.amount

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
    if (!ready || !selected) return
    if (selected.private) void actions.sendToken(selected.id, trimmed, base)
    else void actions.sendNative(trimmed, base, selected.denom ?? DENOM)
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
            {!isPrivate ? (
              <>
                <Eye size={14} aria-hidden className="mt-px shrink-0" />
                {symbol} moves through the bank module, so the amount and both addresses are public. Wrap it
                first if this transfer should not be.
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

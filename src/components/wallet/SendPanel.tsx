import {
  ArrowLeftRight,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  Eye,
  Loader2,
  ShieldCheck
} from 'lucide-react'
import { useEffect, useId, useMemo, useState } from 'react'

import AmountHero from '@/components/ui/AmountHero'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { PickerDialog } from '@/components/ui/Picker'
import ShareSlider from '@/components/ui/ShareSlider'
import { DECIMALS, DENOM, DISPLAY_DENOM, explorerTxUrl } from '@/chains/secret4'
import { chainImageUrl } from '@/chains/sources'
import { cn } from '@/lib/cn'
import { formatAmount, fromBaseUnits, shortenAddress, toBaseUnits } from '@/lib/format'
import { destinationOf, planIbcSend, type IbcPlan } from '@/lib/ibcSend'
import type { Balances } from '@/hooks/useBalances'
import { useWalletActions } from '@/hooks/useWalletActions'
import { useSettings } from '@/store/settings'
import { privateSymbol, SSCRT_ADDRESS, tokenImageUrl } from '@/tokens/registry'

interface Props {
  open: boolean
  onClose: () => void
  balances: Balances
  /** Preselected by the row the send was started from. */
  asset?: string
  /** Prefilled recipient — a donation opened from someone's profile. */
  recipient?: string
  /**
   * The recipient cannot be edited.
   *
   * For a donation, where the page already established who is being paid.
   * Letting it be typed over would turn "give this person something" into a
   * general send form that happens to start on the right address, and the one
   * mistake worth designing out here is paying the wrong account.
   */
  recipientLocked?: boolean
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
  /** The SNIP-20 this is a form of — sSCRT for native SCRT. What bridge routes are keyed by. */
  token: string
  /** Price of one whole unit in the chosen currency; absent when unpriced. */
  unitPrice?: number
}

/**
 * One unit's price, recovered from what the balance is worth.
 *
 * `useBalances` prices holdings, not units, and dividing back out is cheaper
 * than a second price query that could disagree with the figure on the wallet
 * screen. A zero or unpriced balance gives no price, and the fiat view is then
 * simply not offered.
 */
function unitPriceOf(amount: string, decimals: number, fiat: number | undefined): number | undefined {
  if (fiat === undefined) return undefined
  const units = Number(fromBaseUnits(amount, decimals))
  return units > 0 ? fiat / units : undefined
}

/**
 * Sending, from a dialog rather than a page of its own.
 *
 * Laid out the way Uniswap's send is, because it puts the one number that
 * matters first and largest: the amount, centred, with the asset under it and
 * the recipient in a card of its own below. Separate cards rather than one
 * column of labelled fields, so the eye lands on the figure before it reads
 * anything else.
 *
 * Public and private sit in one list because from here they are the same task,
 * but they are not the same transaction and the difference is the one thing
 * worth saying out loud: a bank transfer is public and a SNIP-20 transfer is
 * not. That is the reason most of these tokens exist, so the form says which
 * one is about to happen.
 */
export default function SendPanel({
  open,
  onClose,
  balances,
  asset,
  recipient: prefilled,
  recipientLocked = false,
  onDone
}: Props) {
  const actions = useWalletActions(onDone)
  const lockedNoteId = useId()

  const [assetId, setAssetId] = useState(NATIVE_ID)
  const [recipient, setRecipient] = useState(prefilled ?? '')
  const [amount, setAmount] = useState('')
  const [picking, setPicking] = useState(false)
  const currency = useSettings((state) => state.currency)

  // A panel that reopens showing the last transfer's receipt is a panel that
  // looks like it is about to send it again.
  useEffect(() => {
    if (!open) return
    setRecipient(prefilled ?? '')
    setAmount('')
    actions.reset()
    if (asset) setAssetId(asset)
    // Only when the panel opens; `actions` is rebuilt on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, asset, prefilled])

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
        denom: held.denom,
        token: native ? SSCRT_ADDRESS : held.token!.address,
        unitPrice: unitPriceOf(held.amount, native ? DECIMALS : held.token!.decimals, held.fiat)
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
        private: true,
        token: row.token.address,
        unitPrice: unitPriceOf(row.outcome.amount, row.token.decimals, row.fiat)
      })
    }

    return rows
  }, [balances.publicBalances, balances.tokens])

  const loadingTokens = balances.loading || balances.scanning

  const trimmed = recipient.trim()
  const destination = trimmed ? destinationOf(trimmed) : undefined
  const chain = destination?.kind === 'chain' ? destination.chain : undefined

  const options = sendable.map((row) => ({
    id: row.id,
    label: row.symbol,
    // While the recipient is on another chain, say up front which assets
    // cannot get there rather than letting someone pick one and find out.
    detail: chain && !planIbcSend(row, chain).ok ? `Cannot go to ${chain.name}` : row.detail,
    image: row.image,
    meta: formatAmount(row.amount, { decimals: row.decimals })
  }))

  const selected = sendable.find((row) => row.id === assetId) ?? sendable[0]
  const isPrivate = selected?.private ?? false
  const decimals = selected?.decimals ?? DECIMALS
  const symbol = selected?.symbol ?? DISPLAY_DENOM
  const image = selected?.image
  const available = selected?.amount
  const unitPrice = selected?.unitPrice
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

  const plan: IbcPlan | undefined = chain && selected ? planIbcSend(selected, chain) : undefined

  const recipientError = !destination
    ? undefined
    : destination.kind === 'invalid'
      ? trimmed.startsWith('secret1')
        ? 'That address fails its checksum — a character is wrong.'
        : 'Not a valid address — a character is wrong or missing.'
      : destination.kind === 'unknown'
        ? `"${destination.prefix}1…" is an address on a chain this dashboard has no route to.`
        : chain && plan && !plan.ok
          ? `${symbol} cannot be sent to ${chain.name}. Pick another asset.`
          : undefined

  const ready = Boolean(trimmed) && !recipientError && Boolean(amount) && !amountError && BigInt(base) > 0n

  const submit = () => {
    if (!ready || !selected) return
    const summary = {
      label: `Send ${amount} ${symbol}${chain ? ` to ${chain.name}` : ''}`,
      detail: `to ${shortenAddress(trimmed)}`
    }
    if (chain) {
      if (!plan?.ok) return
      void actions.sendIbc({
        chain,
        recipient: trimmed,
        denom: plan.denom,
        amount: base,
        channel: plan.channel,
        unwrap: plan.unwrap,
        forward: plan.forward,
        summary
      })
    } else if (selected.private) void actions.sendToken(selected.id, trimmed, base, summary)
    else void actions.sendNative(trimmed, base, selected.denom ?? DENOM, summary)
  }

  return (
    <Modal open={open} onClose={onClose} title="Send">
      {actions.state.kind === 'done' ? (
        <Receipt
          hash={actions.state.hash}
          chainName={chain?.name}
          onAgain={() => {
            setAmount('')
            // Back to the locked recipient, not to blank — "send another" from
            // a donation still means to the same person.
            setRecipient(prefilled ?? '')
            actions.reset()
          }}
        />
      ) : (
        <>
          {/* The amount, first and largest. */}
          <div className="flex flex-col gap-4 rounded-card border border-border bg-surface p-4">
            <span className="text-label text-text-muted">You&rsquo;re sending</span>
            <AmountHero
              amount={amount}
              onAmount={setAmount}
              symbol={symbol}
              decimals={decimals}
              unitPrice={unitPrice}
              currency={currency}
            />
            <ShareSlider
              amount={amount}
              onAmount={setAmount}
              available={available}
              decimals={decimals}
              invalid={Boolean(amountError)}
            />
          </div>

          {/*
            The asset, as a row that is itself the picker. While the balances
            are still being read it says so: on a tip from a profile the form
            opens the moment the wallet connects, before anything is known, and
            an empty row with no explanation reads as "you hold nothing".
          */}
          <button
            type="button"
            onClick={() => setPicking(true)}
            disabled={options.length === 0 && !loadingTokens}
            aria-haspopup="dialog"
            className="state-layer -mt-2 flex items-center gap-3 rounded-card border border-border bg-surface px-4 py-3 text-left disabled:cursor-not-allowed disabled:opacity-50"
          >
            {image ? <img src={image} alt="" className="size-8 shrink-0 rounded-pill" /> : null}
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-base font-medium">{symbol}</span>
              <span className="truncate text-label text-text-faint">
                {loadingTokens && available === undefined
                  ? 'Loading your tokens…'
                  : available !== undefined
                    ? `Balance ${formatAmount(available, { decimals })}`
                    : (selected?.detail ?? 'Choose an asset')}
              </span>
            </span>
            {loadingTokens ? (
              <Loader2
                size={16}
                aria-label="Loading your tokens"
                className="shrink-0 animate-spin text-text-muted"
              />
            ) : (
              <ChevronDown size={16} aria-hidden className="shrink-0 text-text-muted" />
            )}
          </button>

          <PickerDialog
            open={picking}
            onClose={() => setPicking(false)}
            label="Asset"
            options={options}
            loading={loadingTokens ? 'Loading your tokens…' : undefined}
            value={assetId}
            onChange={(id) => {
              setAssetId(id)
              setAmount('')
            }}
          />

          {amountError ? (
            <span className="-mt-2 text-base text-negative" role="alert">
              {amountError}
            </span>
          ) : null}

          {/*
            A locked recipient — a tip from someone's profile — is not shown:
            the page the dialog opened over already names who is being paid,
            and repeating the address here is only more to read.
          */}
          {recipientLocked ? null : (
            <label className="-mt-2 flex flex-col gap-1.5 rounded-card border border-border bg-surface px-4 py-3">
              <span className="text-label text-text-muted">To</span>
              <input
                value={recipient}
                onChange={(event) => setRecipient(event.target.value)}
                placeholder="Address on Secret, Cosmos Hub, Osmosis…"
                spellCheck={false}
                autoComplete="off"
                /*
                  `readOnly` rather than `disabled`: a disabled field is dropped
                  from the tab order and read out as unavailable, when what is
                  true here is that the address is settled — it should still be
                  reachable, selectable and copyable.
                */
                readOnly={recipientLocked}
                aria-describedby={recipientLocked ? lockedNoteId : undefined}
                className={cn(
                  'break-address bg-transparent font-mono text-sm outline-none placeholder:font-sans placeholder:text-text-faint',
                  recipientLocked && 'cursor-default text-text-muted'
                )}
              />
              {recipientLocked ? (
                <span id={lockedNoteId} className="text-label text-text-faint">
                  Set by the profile you opened this from.
                </span>
              ) : null}
              {chain ? (
                <span className="flex items-center gap-1.5 text-label text-text-muted">
                  <img src={chainImageUrl(chain)} alt="" className="size-4 shrink-0 rounded-pill" />
                  On {chain.name}
                </span>
              ) : null}
              {recipientError ? (
                <span className="text-label text-negative" role="alert">
                  {recipientError}
                </span>
              ) : null}
            </label>
          )}

          {/*
            Which of the two transactions this is. Someone reaching for a
            private token and getting a public bank transfer has lost the only
            property they came for, and there is nothing after the fact to undo
            it — so it is stated before the button, not after.
          */}
          <p className="flex items-start gap-2 text-label text-text-muted">
            {chain ? (
              <>
                <ArrowLeftRight size={14} aria-hidden className="mt-px shrink-0" />
                {isPrivate
                  ? `Unwrapped and sent to ${chain.name} over IBC in one transaction.`
                  : `Sent to ${chain.name} over IBC.`}{' '}
                {plan?.ok && plan.via
                  ? `It goes through ${plan.via.name}, which passes it on, so it arrives as the ${symbol} ${chain.name} already knows.`
                  : null}{' '}
                The amount and both addresses are public on both chains. It lands once a relayer carries it,
                usually within a minute, and comes back if nobody has in 15 minutes.
              </>
            ) : !isPrivate ? (
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
            {!trimmed
              ? 'Enter a recipient'
              : !amount
                ? 'Enter an amount'
                : chain
                  ? `Send ${symbol} to ${chain.name}`
                  : `Send ${symbol}`}
          </Button>
        </>
      )}
    </Modal>
  )
}

function Receipt({ hash, chainName, onAgain }: { hash: string; chainName?: string; onAgain: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <CheckCircle2 size={18} aria-hidden className="mt-0.5 shrink-0 text-positive" />
        <p className="text-base">
          {chainName
            ? `Sent. It reaches ${chainName} once a relayer carries it, usually within a minute.`
            : 'Sent.'}
        </p>
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

import {
  AlertCircle,
  Coins,
  Copy,
  ExternalLink,
  MoreHorizontal,
  RadioTower,
  Search,
  Send,
  ShieldCheck,
  ShieldOff,
  Timer
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import Button from '@/components/ui/Button'
import Menu, { MenuItem } from '@/components/ui/Menu'
import type { Balances } from '@/hooks/useBalances'
import type { PushStatus } from '@/hooks/useArrivals'
import { DECIMALS, DENOM, DISPLAY_DENOM, explorerAccountUrl } from '@/chains/secret4'
import { cn } from '@/lib/cn'
import { formatDisplayAmount, formatFiat } from '@/lib/format'
import { privateSymbol, tokenImageUrl, type TokenInfo } from '@/tokens/registry'
import { bankDenomFor } from '@/tokens/routes'
import { useSettings } from '@/store/settings'

interface Props {
  balances: Balances
  pushStatus: PushStatus
  /** `native`, `bank:<denom>`, or a SNIP-20 contract address. */
  onSend: (assetId: string) => void
  onWrap: (contract: string) => void
  onUnwrap: (contract: string) => void
}

interface AssetRow {
  id: string
  private: boolean
  symbol: string
  description?: string
  image?: string
  /** Base units. */
  amount: string
  /** Absent for a voucher no registry entry claims — then `amount` is raw. */
  decimals?: number
  fiat?: number
  /** SNIP-20 contract: the row's own for a private token, its wrap target for a public one. */
  contract?: string
  /** Public rows only. */
  denom?: string
}

/** `ibc/0954E1C2…` is not a name anyone reads; show enough to recognise it. */
function shortDenom(denom: string): string {
  return denom.startsWith('ibc/') ? `IBC ${denom.slice(4, 10)}…` : denom
}

/**
 * Everything the account holds, public and private, in one list.
 *
 * Both halves belong here even though they are read in completely different
 * ways — a permit-gated contract query on one side, an open bank query on the
 * other — because to the person holding them they are simply their money, and a
 * public balance left off the screen is a balance nobody remembers to wrap.
 * Which form each row is in is the property this whole dashboard is about, so
 * it is labelled, and the action that changes it sits on the row itself.
 */
export default function BalanceList({ balances, pushStatus, onSend, onWrap, onUnwrap }: Props) {
  const navigate = useNavigate()
  const currency = useSettings((state) => state.currency)
  /** Row whose contract address was just copied, so the row can say so. */
  const [copied, setCopied] = useState<string | undefined>()

  const copyAddress = async (rowId: string, contract: string) => {
    try {
      await navigator.clipboard.writeText(contract)
      setCopied(rowId)
      setTimeout(() => setCopied((current) => (current === rowId ? undefined : current)), 1600)
    } catch {
      // Clipboard access can be refused. The address is on the explorer page
      // the menu also links to, so this is not the only way to reach it.
    }
  }

  const rows = useMemo(() => {
    const built: AssetRow[] = []

    for (const held of balances.publicBalances) {
      const native = held.denom === DENOM
      const token: TokenInfo | undefined = held.token
      built.push({
        id: native ? 'native' : `bank:${held.denom}`,
        private: false,
        symbol: native ? DISPLAY_DENOM : (token?.symbol ?? shortDenom(held.denom)),
        description: native ? 'Secret' : token?.description,
        image: token ? tokenImageUrl(token) : '/img/secret-mark.svg',
        amount: held.amount,
        decimals: native ? DECIMALS : token?.decimals,
        fiat: held.fiat,
        contract: token?.address,
        denom: held.denom
      })
    }

    for (const row of balances.tokens) {
      if (row.outcome.status !== 'ok' || row.outcome.amount === '0') continue
      built.push({
        id: row.token.address,
        private: true,
        symbol: privateSymbol(row.token),
        description: row.token.description,
        image: tokenImageUrl(row.token),
        amount: row.outcome.amount,
        decimals: row.token.decimals,
        fiat: row.fiat,
        contract: row.token.address
      })
    }

    // By what they are worth, so the figure that matters is at the top. Rows
    // with no price sort under the priced ones rather than above them: an
    // unpriced token is not worth more than a priced one, it is just unknown.
    return built.sort((a, b) => (b.fiat ?? -1) - (a.fiat ?? -1) || a.symbol.localeCompare(b.symbol))
  }, [balances.publicBalances, balances.tokens])

  const unreadable = balances.tokens.filter(
    (row) => row.outcome.status === 'error' || row.outcome.status === 'unauthorized'
  )

  if (balances.loading && rows.length === 0) {
    return (
      <section className="flex flex-col gap-4" aria-busy>
        <h2 className="text-title">Tokens</h2>
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3 px-2 py-3">
            <span className="size-8 animate-pulse rounded-pill bg-surface" />
            <span className="h-4 w-24 animate-pulse rounded-control bg-surface" />
            <span className="ml-auto h-4 w-20 animate-pulse rounded-control bg-surface" />
          </div>
        ))}
      </section>
    )
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-baseline gap-2.5">
          <h2 className="text-title">Tokens</h2>
          <span className="text-label text-text-faint">
            {rows.length} {rows.length === 1 ? 'asset' : 'assets'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <PushIndicator status={pushStatus} />
          <Button
            variant="ghost"
            size="sm"
            onClick={balances.scanAll}
            loading={balances.scanning}
            icon={balances.scanning ? undefined : <Search size={15} aria-hidden />}
          >
            {balances.scanning ? `Scanning ${balances.scanProgress[0]}/${balances.scanProgress[1]}` : 'Scan all'}
          </Button>
        </div>
      </div>

      {rows.length > 0 ? (
        /*
          An open table rather than a card. The panel border was drawing a box
          around content that already has the page to itself, and the hairline
          under the column names says everything the box was saying — that a
          list starts here — without closing it in on all four sides.
        */
        <div className="flex flex-col">
          <div className="flex items-center gap-4 border-b border-border px-2 pb-2 text-label text-text-faint">
            <span className="min-w-0 flex-1">Asset</span>
            <span className="w-24 shrink-0 text-right sm:w-28">Balance</span>
            <span className="hidden w-10 shrink-0 sm:block" aria-hidden />
          </div>

          {/*
            Rows are not `state-layer`s: that sets `overflow: hidden`, which
            would cut each row's menu off at the row's own edge.
          */}
          <ul>
            {rows.map((row) => (
              <li
                key={row.id}
                className={cn(
                  'flex flex-wrap items-center gap-x-4 gap-y-2.5 rounded-control px-2 py-3',
                  'transition-colors duration-[var(--duration-short)] ease-[var(--ease-standard)]',
                  'hover:bg-surface-1'
                )}
              >
                <span className="flex min-w-0 flex-1 items-center gap-3">
                  {row.image ? (
                    <img src={row.image} alt="" className="size-8 shrink-0 rounded-pill" />
                  ) : (
                    <span className="size-8 shrink-0 rounded-pill bg-surface" />
                  )}
                  {/*
                    The chip never shrinks and the ticker truncates before the
                    description does. Both lines are allowed to run out of room
                    in a column this narrow, and the order they give way in is
                    the order they matter in.
                  */}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 truncate text-body font-medium">{row.symbol}</span>
                      {copied === row.id ? (
                        <span className="shrink-0 text-label text-positive">Copied</span>
                      ) : (
                        <Tag private={row.private} />
                      )}
                    </span>
                    {row.description ? (
                      <span className="block truncate text-label text-text-faint">{row.description}</span>
                    ) : null}
                  </span>
                </span>

                <span className="w-24 shrink-0 text-right sm:w-28">
                  <span
                    className="block text-body font-medium tabular-nums"
                    title={row.decimals === undefined ? 'Base units — decimal places unknown' : undefined}
                  >
                    {row.decimals === undefined
                      ? row.amount
                      : formatDisplayAmount(row.amount, row.decimals)}
                  </span>
                  {row.fiat !== undefined ? (
                    <span className="block text-label text-text-faint">{formatFiat(row.fiat, currency)}</span>
                  ) : null}
                </span>

                {/*
                  One button per row rather than three. The actions that change
                  what a row *is* — wrap on the public ones, unwrap on the
                  private ones — are the point of this screen, but printed out
                  along every row they turn the list into a wall of verbs and
                  none of them reads as anything.
                */}
                <span className="flex shrink-0 items-center justify-end sm:w-10">
                  <Menu
                    label={`Actions for ${row.symbol}`}
                    triggerClassName="flex size-8 items-center justify-center rounded-pill text-text-muted"
                    trigger={<MoreHorizontal size={18} aria-hidden />}
                  >
                    {row.private && row.contract ? (
                      <MenuItem
                        icon={<Copy size={16} aria-hidden />}
                        onClick={() => void copyAddress(row.id, row.contract!)}
                      >
                        Copy address
                      </MenuItem>
                    ) : null}

                    {/* Not offered for a voucher whose decimal places are
                        unknown: the send form would scale the typed amount by a
                        guess. The balance still shows — it is the account's
                        money — and it can still be bridged out, where the
                        figure is the route's, not ours. */}
                    {row.decimals !== undefined ? (
                      <MenuItem icon={<Send size={16} aria-hidden />} onClick={() => onSend(row.id)}>
                        Send
                      </MenuItem>
                    ) : null}

                    {!row.private && row.contract ? (
                      <MenuItem
                        icon={<ShieldCheck size={16} aria-hidden className="text-accent" />}
                        onClick={() => onWrap(row.contract!)}
                      >
                        Wrap
                      </MenuItem>
                    ) : null}

                    {row.private && row.contract && bankDenomFor(row.contract) ? (
                      <MenuItem
                        icon={<ShieldOff size={16} aria-hidden />}
                        onClick={() => onUnwrap(row.contract!)}
                      >
                        Unwrap
                      </MenuItem>
                    ) : null}

                    {row.denom === DENOM ? (
                      <MenuItem icon={<Coins size={16} aria-hidden />} onClick={() => navigate('/staking')}>
                        Stake
                      </MenuItem>
                    ) : null}

                    {row.contract ? (
                      <MenuItem
                        icon={<ExternalLink size={16} aria-hidden />}
                        onClick={() =>
                          window.open(explorerAccountUrl(row.contract!), '_blank', 'noreferrer,noopener')
                        }
                      >
                        View contract
                      </MenuItem>
                    ) : null}
                  </Menu>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="px-2 py-6 text-base text-text-muted">
          {balances.tokens.length === 0
            ? 'Nothing here yet. Sign the query permit to read your private balances, or bridge something in.'
            : 'No balance in anything checked so far. Scan all tokens to look through the whole registry.'}
        </p>
      )}

      {/* An unreadable token is worth naming. Silently omitting it would let
          someone conclude they hold nothing when the contract simply did not answer. */}
      {unreadable.length > 0 ? (
        <div className="flex items-start gap-3 px-2 text-text-muted">
          <AlertCircle size={16} aria-hidden className="mt-0.5 shrink-0" />
          <p className="text-label">
            {unreadable.length} {unreadable.length === 1 ? 'token' : 'tokens'} could not be read
            {unreadable.some((row) => row.outcome.status === 'unauthorized')
              ? ', some because the permit was rejected'
              : ''}
            . This is not the same as holding none of them.
          </p>
        </div>
      ) : null}
    </section>
  )
}

/**
 * Which half of the wallet a row lives in.
 *
 * Small and quiet, but on every row: it is the one property that decides
 * whether the amount beside it is visible to everyone, and it is what the wrap
 * and unwrap actions in the row's menu change.
 */
function Tag({ private: isPrivate }: { private: boolean }) {
  return (
    <span
      className={cn(
        'shrink-0 rounded-pill px-1.5 py-px text-[0.6875rem] font-medium leading-[1.4]',
        isPrivate ? 'bg-accent-container text-accent' : 'bg-surface text-text-faint'
      )}
    >
      {isPrivate ? 'Private' : 'Public'}
    </span>
  )
}

/**
 * Whether arrivals show up the instant they happen, or on the next refresh.
 *
 * Worth saying out loud: silence means something different in each mode, and a
 * user watching for an incoming transfer deserves to know which one they are in.
 */
function PushIndicator({ status }: { status: PushStatus }) {
  if (status === 'live') {
    return (
      <span className="flex items-center gap-1 text-label text-positive" title="Arrivals appear immediately">
        <RadioTower size={14} aria-hidden />
        Live
      </span>
    )
  }
  if (status === 'connecting') {
    return <span className="text-label text-text-faint">Connecting…</span>
  }
  return (
    <span
      className="flex items-center gap-1 text-label text-text-faint"
      title={
        status === 'off'
          ? 'Push notifications are off. Balances refresh every couple of minutes.'
          : 'Push is unavailable. Balances refresh every couple of minutes.'
      }
    >
      <Timer size={14} aria-hidden />
      Periodic
    </span>
  )
}

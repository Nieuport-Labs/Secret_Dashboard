import {
  AlertCircle,
  ChevronDown,
  Coins,
  Copy,
  ExternalLink,
  HandCoins,
  Hourglass,
  MoreHorizontal,
  Search,
  Send,
  ShieldCheck,
  ShieldOff
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Branch, Branches, Progress } from '@/components/ui/Branches'
import Menu, { MenuItem } from '@/components/ui/Menu'
import UnbondingBranches from '@/components/wallet/UnbondingBranches'
import type { Balances, TokenBalance } from '@/hooks/useBalances'
import type { Derivative } from '@/hooks/useDerivative'
import type { NativeUnbondings } from '@/hooks/useNativeUnbondings'
import { DECIMALS, DENOM, DISPLAY_DENOM, explorerAccountUrl } from '@/chains/secret4'
import { cn } from '@/lib/cn'
import { dismissQueueOffer, queueOfferDismissed } from '@/lib/derivative'
import { formatDisplayAmount, formatFiat, shortenAddress } from '@/lib/format'
import { waitLabel } from '@/lib/wait'
import {
  privateSymbol,
  tokenByAddress,
  tokenImageUrl,
  STKD_SCRT_ADDRESS,
  type TokenInfo
} from '@/tokens/registry'
import { bankDenomFor } from '@/tokens/routes'
import { useSettings } from '@/store/settings'
import { useWallet } from '@/store/wallet'

interface Props {
  balances: Balances
  /** The stkd-SCRT position, which this list shows underneath its own row. */
  derivative: Derivative
  /** Plain SCRT undelegating, shown the same way under the SCRT row. */
  nativeUnbondings: NativeUnbondings
  /** Open the unstake panel, either to unbond or to claim what has matured. */
  onUnstake: () => void
  /** Sign the permit again — offered only where one is refusing a read. */
  onSignPermit: () => void
  /** The derivative's own permit: whether it exists, and how to get one. */
  stakingPermit: { signed: boolean; signing: boolean; error?: string; sign: () => void }
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
export default function BalanceList({
  balances,
  derivative,
  nativeUnbondings,
  onUnstake,
  onSignPermit,
  stakingPermit,
  onSend,
  onWrap,
  onUnwrap
}: Props) {
  const navigate = useNavigate()
  const currency = useSettings((state) => state.currency)
  const address = useWallet((state) => state.address)
  /** Row whose contract address was just copied, so the row can say so. */
  const [copied, setCopied] = useState<string | undefined>()
  const [query, setQuery] = useState('')
  /** Whether the offer to read the derivative's queue has been waved away. */
  const [offerHidden, setOfferHidden] = useState(false)
  /*
   * The unbonding queues start closed. Each is a list of dates, and a list of
   * dates under a row you are scrolling past is noise — what the row owes you
   * at a glance is that something is in there and how much, which the chip
   * says. Opening it is for when you want to know when.
   *
   * Two rows can have one: stkd-SCRT's queue inside Shade's contract, and plain
   * SCRT's inside the staking module. They open independently, because they are
   * separate waits on separate money.
   */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const toggleRow = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
  const offerDeclined = useMemo(() => (address ? queueOfferDismissed(address) : false), [address])

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

    /*
     * Someone who unbonded the lot holds no stkd-SCRT at all — and is exactly
     * the person with SCRT in the queue waiting to be claimed. Without a row
     * there is nothing for that queue to hang under, so the row stands in for
     * the position rather than for the balance, and reads zero.
     */
    const queued = derivative.unbondings.length > 0 || BigInt(derivative.claimable) > 0n
    if (queued && !built.some((row) => row.id === STKD_SCRT_ADDRESS)) {
      const token = tokenByAddress(STKD_SCRT_ADDRESS)
      if (token) {
        built.push({
          id: STKD_SCRT_ADDRESS,
          private: true,
          symbol: token.symbol,
          description: token.description,
          image: tokenImageUrl(token),
          amount: '0',
          decimals: token.decimals,
          fiat: 0,
          contract: token.address
        })
      }
    }

    // The same for plain SCRT: undelegate the lot and the bank balance is zero,
    // so the row that would carry the queue does not exist either.
    if (nativeUnbondings.entries.length > 0 && !built.some((row) => row.id === 'native')) {
      built.push({
        id: 'native',
        private: false,
        symbol: DISPLAY_DENOM,
        description: 'Secret',
        image: '/img/secret-mark.svg',
        amount: '0',
        decimals: DECIMALS,
        fiat: 0,
        denom: DENOM
      })
    }

    // By what they are worth, so the figure that matters is at the top. Rows
    // with no price sort under the priced ones rather than above them: an
    // unpriced token is not worth more than a priced one, it is just unknown.
    return built.sort((a, b) => (b.fiat ?? -1) - (a.fiat ?? -1) || a.symbol.localeCompare(b.symbol))
  }, [
    balances.publicBalances,
    balances.tokens,
    derivative.unbondings,
    derivative.claimable,
    nativeUnbondings.entries
  ])

  /*
   * Filtering, in the place the push status and the "Scan all" button used to
   * sit. Both of those moved into the header — the status because it is true of
   * the whole app and not of this list, the sweep because it is now what
   * pressing that status does. What a list of assets wants in its own corner is
   * a way through it, and once an account holds thirty rows that is the only
   * thing here anyone reaches for.
   */
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return rows
    return rows.filter(
      (row) =>
        row.symbol.toLowerCase().includes(needle) ||
        row.description?.toLowerCase().includes(needle) ||
        row.denom?.toLowerCase().includes(needle) ||
        row.contract?.toLowerCase().includes(needle)
    )
  }, [rows, query])

  /** Whether the list already carries a stkd-SCRT row that asks for itself. */
  const hasDerivative = rows.some((row) => row.id === STKD_SCRT_ADDRESS)
  /** What each row has queued behind it, if anything. */
  const queueTotals: Record<string, { amount: string; ready?: boolean }> = {
    [STKD_SCRT_ADDRESS]:
      BigInt(derivative.claimable) > 0n
        ? { amount: derivative.claimable, ready: true }
        : { amount: derivative.unbondingTotal },
    native: { amount: nativeUnbondings.total }
  }
  const unfolds = (id: string) => BigInt(queueTotals[id]?.amount ?? '0') > 0n

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
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-control bg-surface px-3 py-1.5 sm:max-w-[16rem]">
          <Search size={15} aria-hidden className="shrink-0 text-text-muted" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter assets"
            aria-label="Filter assets"
            className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-text-faint"
          />
        </label>
      </div>

      {visible.length > 0 ? (
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
            {visible.map((row) => (
              <li
                key={row.id}
                /*
                 * The whole row opens the queue, not just the chip — a row with
                 * something hidden under it is the click target people aim at.
                 * The chip stays a real button so the keyboard and a screen
                 * reader have something to land on and something that announces
                 * its state; this is the mouse's shortcut to the same toggle.
                 *
                 * Buttons and links inside the row keep their own jobs: the menu
                 * must not also unfold the thing it is offering actions on.
                 */
                onClick={
                  unfolds(row.id)
                    ? (event) => {
                        if ((event.target as HTMLElement).closest('button, a')) return
                        toggleRow(row.id)
                      }
                    : undefined
                }
                className={cn(
                  'flex flex-wrap items-center gap-x-4 gap-y-2.5 rounded-control px-2 py-3',
                  'transition-colors duration-[var(--duration-short)] ease-[var(--ease-standard)]',
                  'hover:bg-surface-1',
                  unfolds(row.id) ? 'cursor-pointer' : undefined
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
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="min-w-0 truncate text-body font-medium">{row.symbol}</span>
                      {copied === row.id ? (
                        <span className="shrink-0 text-label text-positive">Copied</span>
                      ) : (
                        <Tag private={row.private} />
                      )}
                      {unfolds(row.id) ? (
                        <QueueChip
                          amount={queueTotals[row.id].amount}
                          ready={queueTotals[row.id].ready}
                          open={expanded.has(row.id)}
                          onToggle={() => toggleRow(row.id)}
                        />
                      ) : null}
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
                    {row.decimals === undefined ? row.amount : formatDisplayAmount(row.amount, row.decimals)}
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

                    {/* The one token in this registry that is also a staking
                        position: it can be taken back to SCRT, not only sold.
                        Not offered on a row standing in for an empty balance —
                        there is nothing there to unbond, only a queue to watch. */}
                    {row.id === STKD_SCRT_ADDRESS && BigInt(row.amount) > 0n ? (
                      <MenuItem icon={<Hourglass size={16} aria-hidden />} onClick={onUnstake}>
                        Unstake
                      </MenuItem>
                    ) : null}

                    {row.id === STKD_SCRT_ADDRESS && BigInt(derivative.claimable) > 0n ? (
                      <MenuItem
                        icon={<HandCoins size={16} aria-hidden className="text-positive" />}
                        onClick={onUnstake}
                      >
                        Claim {formatDisplayAmount(derivative.claimable)} {DISPLAY_DENOM}
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

                {row.id === STKD_SCRT_ADDRESS ? (
                  <Queue
                    derivative={derivative}
                    open={expanded.has(row.id)}
                    onClaim={onUnstake}
                    permit={stakingPermit}
                  />
                ) : null}

                {row.id === 'native' ? (
                  <StakingQueue unbondings={nativeUnbondings} open={expanded.has(row.id)} />
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="px-2 py-6 text-base text-text-muted">
          {query.trim()
            ? `Nothing matches. ${rows.length} ${rows.length === 1 ? 'asset' : 'assets'} held in total.`
            : balances.tokens.length === 0
              ? 'Nothing here yet. Sign the query permit to read your private balances, or bridge something in.'
              : 'No balance in anything checked so far. The status in the header reads every token in the registry.'}
        </p>
      )}

      {/*
        The queue that no balance can show.
        
        An unbonding position has left the token and not yet arrived as SCRT, so
        an account in the middle of one holds nothing anywhere and has no row to
        hang a prompt off — which is exactly the account with money in there.
        Reading it needs a signature, and a signature cannot be asked for by a
        screen that does not know whether there is anything to read. So it is
        offered, once, with a way to say no that sticks.
      */}
      {address && !stakingPermit.signed && !offerHidden && !offerDeclined && !hasDerivative ? (
        <div className="flex items-start gap-3 px-2 text-text-muted">
          <Hourglass size={16} aria-hidden className="mt-0.5 shrink-0" />
          <p className="text-label">
            stkd-SCRT on its way back to SCRT shows up in no balance at all, and reading that queue needs its
            own signature.{' '}
            <button
              type="button"
              onClick={stakingPermit.sign}
              disabled={stakingPermit.signing}
              className="text-accent underline underline-offset-4 disabled:opacity-60"
            >
              {stakingPermit.signing ? 'Waiting for the wallet…' : 'Check for one'}
            </button>
            {' · '}
            <button
              type="button"
              onClick={() => {
                dismissQueueOffer(address)
                setOfferHidden(true)
              }}
              className="underline underline-offset-4"
            >
              Not mine
            </button>
          </p>
        </div>
      ) : null}

      {stakingPermit.error ? (
        <p className="break-words px-2 text-label text-negative" role="alert">
          {stakingPermit.error}
        </p>
      ) : null}

      {/*
        An unreadable token is worth naming — and until now this said "1 token
        could not be read" and left you to guess which one and why, which is a
        worse place to stand than not being told at all. So it names them, and
        it carries the contract's own words for the failure: "the node timed
        out" and "the permit was rejected" are the same sentence here and the
        same shrug on screen, but only one of them is fixed by waiting.
      */}
      {unreadable.length > 0 ? (
        <div className="flex items-start gap-3 px-2 text-text-muted">
          <AlertCircle size={16} aria-hidden className="mt-0.5 shrink-0" />
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-label">
              Could not read {nameList(unreadable)}. This is not the same as holding none of them.
            </p>

            {reasonsFor(unreadable).map((reason) => (
              <p key={reason} className="break-words text-label text-text-faint">
                {reason}
              </p>
            ))}

            {unreadable.some((row) => row.outcome.status === 'unauthorized') ? (
              <button
                type="button"
                onClick={onSignPermit}
                className="self-start text-label text-accent underline underline-offset-4"
              >
                Re-sign permit
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  )
}

/**
 * The tokens, by name, with a limit.
 *
 * Three is where a list stops being a list and becomes a paragraph. Past that
 * the count carries it: nobody reads the fourth ticker, and after a failed
 * sweep the number is the thing that matters anyway.
 */
function nameList(rows: TokenBalance[]): string {
  const names = rows.map((row) => privateSymbol(row.token))
  if (names.length <= 3)
    return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  return `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`
}

/**
 * Why, in the contract's or the node's own words.
 *
 * Deduplicated, because a sweep that loses its endpoint fails ninety-six times
 * with one message and printing it ninety-six times says nothing new. Two at
 * most: a third distinct failure is a story for the console, not for a line
 * under a list of balances.
 */
function reasonsFor(rows: TokenBalance[]): string[] {
  const seen = new Set<string>()
  for (const row of rows) {
    if (row.outcome.status !== 'error' && row.outcome.status !== 'unauthorized') continue
    const message = row.outcome.message.trim()
    if (message) seen.add(message.length > 160 ? `${message.slice(0, 160)}…` : message)
    if (seen.size === 2) break
  }
  return [...seen]
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
 * What the collapsed row says about the queue.
 *
 * One figure, not two: money already claimable outranks money still on its way,
 * because one of them is something to do and the other is something to wait
 * for. The rest of the split is one click away.
 */
function QueueChip({
  amount,
  ready,
  open,
  onToggle
}: {
  amount: string
  ready?: boolean
  open: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={cn(
        'flex shrink-0 items-center gap-1 rounded-pill px-1.5 py-px',
        'text-[0.6875rem] font-medium leading-[1.4]',
        // No container colour is defined for `positive`, so the state reads
        // through the text and the icon rather than through an invented tint.
        'bg-surface',
        ready ? 'text-positive' : 'text-text-muted'
      )}
    >
      {ready ? <HandCoins size={11} aria-hidden /> : <Hourglass size={11} aria-hidden />}
      {formatDisplayAmount(amount)} {DISPLAY_DENOM} {ready ? 'ready' : 'unstaking'}
      <ChevronDown
        size={11}
        aria-hidden
        className={cn(
          'transition-transform duration-[var(--duration-short)] ease-[var(--ease-standard)]',
          open && 'rotate-180'
        )}
      />
    </button>
  )
}

/**
 * Plain SCRT undelegating from validators, under the SCRT row.
 *
 * The rows themselves are `UnbondingBranches`, shared with the staking screen —
 * the same undelegations are listed there, and two components drawing one list
 * is how two screens end up disagreeing about when the money arrives.
 */
function StakingQueue({ unbondings, open }: { unbondings: NativeUnbondings; open: boolean }) {
  if (!open) return null

  return (
    <UnbondingBranches
      gutter
      seconds={unbondings.unbondingSeconds}
      rows={unbondings.entries.map((row) => ({
        amount: row.amount,
        at: row.at,
        label: row.moniker ?? shortenAddress(row.validatorAddress, 12, 5, { reveal: true })
      }))}
    />
  )
}

/**
 * The stkd-SCRT unbonding queue, hanging off the row it belongs to.
 *
 * Indented under its token rather than given a section of its own, because
 * these are not holdings — they are one holding in transit, and a queue listed
 * somewhere else is a queue nobody connects to the balance it came out of. The
 * elbows are doing the work a heading would otherwise have to: everything here
 * is a consequence of the line above it.
 *
 * Deliberately sparse. A row is an amount, how far along it is and when it
 * lands; a progress bar per entry is the only ornament, and it is there because
 * "ready in 14 days" means nothing until you can see how much of the wait is
 * already behind you.
 */
function Queue({
  derivative,
  open,
  onClaim,
  permit
}: {
  derivative: Derivative
  open: boolean
  onClaim: () => void
  permit: { signed: boolean; signing: boolean; error?: string; sign: () => void }
}) {
  const { unbondings, claimable, nextBatch, needsPermit, error, info } = derivative

  /*
   * The queue needs a signature the rest of the wallet does not, so it asks
   * here rather than on the page's permit card: this is the one place where
   * what the signature buys is visible, and an account with nothing in the
   * derivative is never asked at all.
   */
  if (needsPermit) {
    return (
      <Branches>
        <Branch last>
          <span className="text-text-muted">
            {permit.signed
              ? 'Your stkd-SCRT permit was refused. '
              : 'Reading the unbonding queue needs one more signature, for stkd-SCRT alone. '}
            <button
              type="button"
              onClick={permit.sign}
              disabled={permit.signing}
              className="text-accent underline underline-offset-4 disabled:opacity-60"
            >
              {permit.signing ? 'Waiting for the wallet…' : permit.signed ? 'Sign again' : 'Sign'}
            </button>
          </span>
        </Branch>
      </Branches>
    )
  }

  if (error) {
    return (
      <Branches>
        <Branch last>
          <span className="break-words text-text-faint">The unbonding queue could not be read: {error}</span>
        </Branch>
      </Branches>
    )
  }

  // Oldest first — the order they will come back in, and the order a queue is
  // read in everywhere else.
  const pending = unbondings
    .filter((row) => !row.mature)
    .sort((a, b) => (a.at?.getTime() ?? Infinity) - (b.at?.getTime() ?? Infinity))

  const ready = BigInt(claimable) > 0n
  const queued = BigInt(nextBatch.amount) > 0n
  if (!ready && !queued && pending.length === 0) return null

  // The chip in the row carries the summary; this is the detail behind it.
  if (!open) return null

  const total = (ready ? 1 : 0) + pending.length + (queued ? 1 : 0)

  return (
    <Branches>
      {ready ? (
        <Branch last={total === 1}>
          <span className="w-28 shrink-0 tabular-nums text-text">
            {formatDisplayAmount(claimable)} {DISPLAY_DENOM}
          </span>
          <span className="flex-1 text-positive">Ready to claim</span>
          <button
            type="button"
            onClick={onClaim}
            className="shrink-0 text-accent underline underline-offset-4"
          >
            Claim
          </button>
        </Branch>
      ) : null}

      {pending.map((row, index) => (
        <Branch
          key={`${row.at?.getTime() ?? 'batch'}-${index}`}
          last={!queued && index === pending.length - 1}
        >
          {/* A figure the contract did not express in base units is printed as
              it arrived rather than as a confident zero. */}
          <span
            className="w-28 shrink-0 tabular-nums text-text"
            title={row.rawAmount ? 'The contract did not return this as base units' : undefined}
          >
            {row.rawAmount ?? `${formatDisplayAmount(row.amount)} ${DISPLAY_DENOM}`}
          </span>
          <span className="min-w-0 flex-1" aria-hidden />
          <Progress at={row.at} seconds={info?.unbondingSeconds} />
          <span className="shrink-0 text-text-faint">{waitLabel(row.at)}</span>
        </Branch>
      ))}

      {/*
        Last, because it is the furthest from arriving: it has not left yet.
        Without this row someone who pressed Unstake an hour ago is told their
        money is nowhere — the contract holds the request until the next batch
        goes out, and only then does anything with a date exist.
      */}
      {queued ? (
        <Branch last>
          <span className="w-28 shrink-0 tabular-nums text-text">
            {nextBatch.rawAmount ?? `${formatDisplayAmount(nextBatch.amount)} ${DISPLAY_DENOM}`}
          </span>
          <span className="flex-1 text-text-faint">In the next batch</span>
          <span className="shrink-0 text-text-faint">{waitLabel(nextBatch.at)}</span>
        </Branch>
      ) : null}
    </Branches>
  )
}

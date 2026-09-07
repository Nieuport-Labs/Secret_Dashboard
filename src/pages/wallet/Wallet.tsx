import { KeyRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { useCallback } from 'react'

import Button from '@/components/ui/Button'
import ActivityList from '@/components/wallet/ActivityList'
import BalanceList from '@/components/wallet/BalanceList'
import ProfileHeader from '@/components/wallet/ProfileHeader'
import ReceiveDrawer from '@/components/wallet/ReceiveDrawer'
import SendPanel from '@/components/wallet/SendPanel'
import WrapPanel from '@/components/wallet/WrapPanel'
import { type WalletPanel } from '@/components/wallet/panels'
import { DISPLAY_DENOM } from '@/chains/secret4'
import { useBalances } from '@/hooks/useBalances'
import { usePermit } from '@/hooks/usePermit'
import { useArrivals } from '@/hooks/useArrivals'
import { useActivity } from '@/hooks/useActivity'
import { resolveLcdUrl } from '@/lib/endpoint'
import { formatDisplayAmount, formatFiat } from '@/lib/format'
import { queryStakingApr } from '@/lib/staking'
import { useSettings } from '@/store/settings'
import { useWallet } from '@/store/wallet'

/** Column widths shared by the identity/balance row and the balances/activity
 *  row below it, so "Available" lines up under itself and ends up exactly as
 *  wide as "Recent activity" rather than a width picked to look right once. */
const TWO_COLUMN = 'grid items-start gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(17rem,1fr)] lg:gap-8'

/** The connected wallet (Figma 34:594 and 36:181). */
export default function Wallet() {
  const navigate = useNavigate()
  const address = useWallet((state) => state.address)
  const currency = useSettings((state) => state.currency)
  const lcdOverride = useSettings((state) => state.lcdOverride)
  const { permit, staleTokens, signing, error, sign } = usePermit()
  const balances = useBalances(permit)
  const activity = useActivity(permit)

  // Decoration riding along on the Stake button, not the full staking screen's
  // own read — that also fetches every validator, delegation and reward,
  // which this page has no other use for.
  const [apr, setApr] = useState<number | undefined>()
  useEffect(() => {
    let cancelled = false
    void resolveLcdUrl(lcdOverride)
      .then(queryStakingApr)
      .then((value) => {
        if (!cancelled) setApr(value)
      })
      .catch(() => {
        if (!cancelled) setApr(undefined)
      })
    return () => {
      cancelled = true
    }
  }, [lcdOverride])

  // Anything that moves money moves both lists. They are read separately and
  // would otherwise disagree until one of them next polled.
  const activityRefresh = activity.refresh
  const balancesRefresh = balances.refresh
  const refreshAll = useCallback(() => {
    balancesRefresh()
    activityRefresh()
  }, [balancesRefresh, activityRefresh])

  const push = useArrivals(permit, { onArrival: refreshAll })
  const [panel, setPanel] = useState<WalletPanel | null>(null)
  /** Which token the wrap panel should open on, when a toast or a row asked. */
  const [wrapToken, setWrapToken] = useState<string | undefined>()
  const [wrapDirection, setWrapDirection] = useState<'wrap' | 'unwrap' | undefined>()
  /** Which asset the send panel should open on. */
  const [sendAsset, setSendAsset] = useState<string | undefined>()
  const [search, setSearch] = useSearchParams()

  // A notification can ask for a panel by link, which is how the "do you want
  // to wrap it?" toast leads somewhere rather than just closing.
  useEffect(() => {
    const requested = search.get('panel')
    if (requested === 'send' || requested === 'receive' || requested === 'wrap') {
      setPanel(requested)
      setWrapToken(search.get('token') ?? undefined)
      setWrapDirection(undefined)
      search.delete('panel')
      search.delete('token')
      setSearch(search, { replace: true })
    }
  }, [search, setSearch])

  const openPanel = (next: WalletPanel) => {
    setSendAsset(undefined)
    setWrapDirection(undefined)
    setPanel(next)
  }

  if (!address) return null

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-10">
      <div className={TWO_COLUMN}>
        <ProfileHeader address={address} onOpenPanel={openPanel} />

        <AvailablePanel
          native={balances.native}
          nativeFiat={balances.nativeFiat}
          currency={currency}
          loading={balances.loading}
          apr={apr}
          onStake={() => navigate('/staking')}
        />
      </div>

      {balances.error ? (
        <p className="card px-4 py-3 text-base text-text-muted" role="alert">
          Your {DISPLAY_DENOM} balance could not be read: {balances.error}
        </p>
      ) : null}

      {!permit ? <PermitPrompt signing={signing} error={error} onSign={() => void sign()} /> : null}

      {/*
        A permit names the tokens it covers, so one signed before a token joined
        the registry does not cover it. Saying so beats a row reading "could not
        be read" for a reason nobody can act on.
      */}
      {permit && staleTokens.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 card px-4 py-3">
          <p className="text-base text-text-muted">
            {staleTokens.length} {staleTokens.length === 1 ? 'token is' : 'tokens are'} newer than your permit
            and cannot be read yet.
          </p>
          <Button variant="soft" shape="control" size="sm" loading={signing} onClick={() => void sign()}>
            Re-sign permit
          </Button>
        </div>
      ) : null}

      {/*
        Balances and activity side by side, not stacked. They answer different
        questions — what do I hold, and what just happened — and stacking them
        puts the second one below the fold of a list that grows, where nobody
        goes looking for it.
      */}
      {/*
        Proportional columns, not a fixed sidebar. With the rail taking 256px,
        this page's own width on a 1280 screen is nearer 700 than 1180, and a
        fixed 20rem column ate half of it — leaving token rows too narrow to
        print a ticker in. Activity keeps a floor of 17rem so its two lines
        still read, and everything past that goes to the balances.
      */}
      <div className={TWO_COLUMN}>
        <BalanceList
          balances={balances}
          pushStatus={push.status}
          onSend={(assetId) => {
            setSendAsset(assetId)
            setPanel('send')
          }}
          onWrap={(contract) => {
            setWrapToken(contract)
            setWrapDirection('wrap')
            setPanel('wrap')
          }}
          onUnwrap={(contract) => {
            setWrapToken(contract)
            setWrapDirection('unwrap')
            setPanel('wrap')
          }}
        />

        <ActivityList
          entries={activity.entries}
          loading={activity.loading}
          unreadable={activity.unreadable}
          publicError={activity.publicError}
        />
      </div>

      <ReceiveDrawer open={panel === 'receive'} onClose={() => setPanel(null)} address={address} />

      {/* Send and Wrap share Receive's panel rather than being pages of their own. */}
      <SendPanel
        open={panel === 'send'}
        onClose={() => setPanel(null)}
        balances={balances}
        asset={sendAsset}
        onDone={refreshAll}
      />

      <WrapPanel
        open={panel === 'wrap'}
        onClose={() => setPanel(null)}
        balances={balances}
        token={wrapToken}
        direction={wrapDirection}
        onDone={refreshAll}
      />
    </div>
  )
}

/**
 * "Total $SCRT Available" in the design means the native balance, not the sum
 * of everything held — it is the figure that decides whether you can pay for
 * a transaction, which is why it earns the largest type on the screen. Its
 * dollar sign and orange colouring are dropped: a ticker does not take a
 * currency symbol outside a trading forum, and colour on a number means
 * something changed — a balance permanently orange has spent that signal on
 * nothing.
 *
 * Sized by the same grid column as `ActivityList`, not by a width guessed to
 * match it — see `TWO_COLUMN` above.
 */
function AvailablePanel({
  native,
  nativeFiat,
  currency,
  loading,
  apr,
  onStake
}: {
  native?: string
  nativeFiat?: number
  currency: string
  loading: boolean
  apr?: number
  onStake: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-label text-text-muted">Available</p>
        {loading && native === undefined ? (
          <span className="mt-1.5 block h-8 w-32 animate-pulse rounded-control bg-surface" />
        ) : (
          <p className="mt-1.5 text-headline tabular-nums">
            {native === undefined ? (
              'Unavailable'
            ) : (
              <>
                {formatDisplayAmount(native)} <span className="text-title text-text-muted">{DISPLAY_DENOM}</span>
              </>
            )}
          </p>
        )}
        <p className="mt-0.5 text-label text-text-faint">{formatFiat(nativeFiat, currency)}</p>
      </div>

      <div className="relative flex shrink-0 flex-col items-center">
        {apr !== undefined ? (
          <span className="absolute -top-3 z-10 whitespace-nowrap rounded-pill bg-accent-strong px-2.5 py-0.5 text-[0.6875rem] font-semibold text-[var(--color-accent-text)]">
            {(apr * 100).toFixed(2)}% APR
          </span>
        ) : null}
        <Button variant="soft" shape="control" onClick={onStake}>
          Stake
        </Button>
      </div>
    </div>
  )
}

function PermitPrompt({ signing, error, onSign }: { signing: boolean; error?: string; onSign: () => void }) {
  return (
    <div className="card flex flex-col items-start gap-4 p-5">
      <div className="flex items-start gap-3">
        <KeyRound size={18} aria-hidden className="mt-0.5 shrink-0 text-accent" />
        <div>
          <h2 className="text-title">Sign a query permit</h2>
          <p className="mt-1 max-w-[62ch] text-base text-text-muted">
            Reading your own private balances needs your signature, not a transaction. Nothing is written to
            the chain and there is no fee. Older dashboards made you pay for a viewing key first.
          </p>
        </div>
      </div>
      <Button variant="primary" loading={signing} onClick={onSign}>
        Sign permit
      </Button>
      {error ? (
        <p className="text-base text-negative" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

import { KeyRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import Button from '@/components/ui/Button'
import BalanceList from '@/components/wallet/BalanceList'
import HistoryList from '@/components/wallet/HistoryList'
import ProfileHeader from '@/components/wallet/ProfileHeader'
import ReceiveDrawer from '@/components/wallet/ReceiveDrawer'
import SendPanel from '@/components/wallet/SendPanel'
import WrapPanel from '@/components/wallet/WrapPanel'
import { type WalletPanel } from '@/components/wallet/panels'
import { DISPLAY_DENOM } from '@/chains/secret4'
import { useBalances } from '@/hooks/useBalances'
import { usePermit } from '@/hooks/usePermit'
import { useArrivals } from '@/hooks/useArrivals'
import { useTransferHistory } from '@/hooks/useTransferHistory'
import { useWallet } from '@/store/wallet'

/** The connected wallet (Figma 34:594 and 36:181). */
export default function Wallet() {
  const address = useWallet((state) => state.address)
  const { permit, staleTokens, signing, error, sign } = usePermit()
  const balances = useBalances(permit)
  const history = useTransferHistory(permit)
  const push = useArrivals(permit, { onArrival: balances.refresh })
  const [panel, setPanel] = useState<WalletPanel | null>(null)
  /** Which token the wrap panel should open on, when a toast asked for one. */
  const [wrapToken, setWrapToken] = useState<string | undefined>()
  const [search, setSearch] = useSearchParams()

  // A notification can ask for a panel by link, which is how the "do you want
  // to wrap it?" toast leads somewhere rather than just closing.
  useEffect(() => {
    const requested = search.get('panel')
    if (requested === 'send' || requested === 'receive' || requested === 'wrap') {
      setPanel(requested)
      setWrapToken(search.get('token') ?? undefined)
      search.delete('panel')
      search.delete('token')
      setSearch(search, { replace: true })
    }
  }, [search, setSearch])

  if (!address) return null

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-10">
      <ProfileHeader
        address={address}
        native={balances.native}
        nativeFiat={balances.nativeFiat}
        loading={balances.loading}
        onOpenPanel={setPanel}
      />

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

      <BalanceList
        tokens={balances.tokens}
        loading={balances.loading}
        scanning={balances.scanning}
        scanProgress={balances.scanProgress}
        pushStatus={push.status}
        onScanAll={balances.scanAll}
      />

      <HistoryList
        entries={history.entries}
        loading={history.loading}
        unreadable={history.unreadable}
        hasPermit={Boolean(permit)}
      />

      <ReceiveDrawer open={panel === 'receive'} onClose={() => setPanel(null)} address={address} />

      {/* Send and Wrap share Receive's panel rather than being pages of their own. */}
      <SendPanel open={panel === 'send'} onClose={() => setPanel(null)} balances={balances} />

      <WrapPanel
        open={panel === 'wrap'}
        onClose={() => setPanel(null)}
        balances={balances}
        token={wrapToken}
      />
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

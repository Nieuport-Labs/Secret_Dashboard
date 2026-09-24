import { ArrowDownToLine, Check, Copy, Eye, Plus, Trash2, TriangleAlert, Users } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

import Button from '@/components/ui/Button'
import EmptyState from '@/components/ui/EmptyState'
import Avatar from '@/components/wallet/Avatar'
import BalanceList from '@/components/wallet/BalanceList'
import ReceiveModal from '@/components/wallet/ReceiveModal'
import { DISPLAY_DENOM } from '@/chains/secret4'
import { useBalances } from '@/hooks/useBalances'
import { errorMessage } from '@/lib/errors'
import { formatDisplayAmount, formatFiat, shortenAddress } from '@/lib/format'
import { fetchAccountMeta } from '@/lib/multisig/account'
import { exportConfig, fingerprintOf, type MultisigConfig } from '@/lib/multisig/config'
import { ageLabel, awaitsSignature, stageOf } from '@/lib/multisig/stage'
import { viewingKeyAuth } from '@/lib/snip20'
import { useProposalsFor, type ProposalEntry } from '@/store/multisigProposals'
import { forgetMultisig, useActiveMultisigConfig, useMembership } from '@/store/multisig'
import { useSettings } from '@/store/settings'
import { useAccountKeys } from '@/store/viewingKeys'
import { useWallet } from '@/store/wallet'
import { SignatureBar, StageBadge } from './components/ProposalCard'

/**
 * The account, laid out like the wallet screen, because it is one.
 *
 * Who you are and what you can spend across the top, then what you hold beside
 * what is happening to it — the same shape as `/wallet`, using the same
 * balance list, so that switching accounts in the rail changes whose money is
 * on screen and nothing else. Learning a second layout to read the same facts
 * was a cost the group was paying for no reason.
 *
 * What differs is what a click can do. Every action here is a proposal rather
 * than a transaction, so the list's menu says "propose" and means it, and the
 * things that are true of a shared account and of nothing else — the members,
 * the viewing key, the fingerprint, whether the chain has heard of this
 * address at all — sit below what the account holds, and the housekeeping
 * among them is one quiet line rather than three panels.
 */

/** The wallet's own column widths, so the two screens line up figure for figure. */
const TWO_COLUMN = 'grid items-start gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(17rem,1fr)] lg:gap-8'

export default function Multisig() {
  const navigate = useNavigate()
  const config = useActiveMultisigConfig()
  const membership = useMembership(config)
  const client = useWallet((state) => state.queryClient)
  const walletAddress = useWallet((state) => state.address)
  const currency = useSettings((state) => state.currency)
  const keys = useAccountKeys(config?.address)
  const proposals = useProposalsFor(config?.address)

  const [funded, setFunded] = useState<boolean | undefined>()
  const [receiving, setReceiving] = useState(false)

  const address = config?.address
  useEffect(() => {
    if (!client || !address) return
    let cancelled = false
    void fetchAccountMeta(client, address)
      .then((meta) => {
        if (!cancelled) setFunded(Boolean(meta))
      })
      .catch(() => {
        if (!cancelled) setFunded(undefined)
      })
    return () => {
      cancelled = true
    }
  }, [client, address])

  const balances = useBalances(
    keys ? viewingKeyAuth(config?.address ?? '', keys.key) : undefined,
    config?.address,
    keys?.contracts ?? []
  )

  if (!config) {
    return (
      <EmptyState
        icon={Users}
        title="No multisig open"
        description="Add one from the account menu, or create a new one."
        action={<Button onClick={() => navigate('/multisig/new')}>Create a multisig</Button>}
      />
    )
  }

  /** Every action on this screen is the same navigation with a different form. */
  const propose = (preset: string, extra?: Record<string, string>) =>
    navigate('/multisig/propose', { state: { preset, ...extra } })

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-10">
      <div className={TWO_COLUMN}>
        <Identity
          config={config}
          isMember={membership.isMember}
          connected={Boolean(walletAddress)}
          // The list of things the group could do, not a guess at which one.
          onPropose={() => navigate('/multisig/propose')}
          onReceive={() => setReceiving(true)}
        />

        <AvailablePanel
          native={balances.native}
          nativeFiat={balances.nativeFiat}
          currency={currency}
          loading={balances.loading}
          canPropose={membership.isMember}
          onStake={() => propose('stake')}
        />
      </div>

      {!walletAddress ? (
        <Notice>
          Nothing is connected, so this account can only be looked at. Connect a wallet that holds one of its
          member keys to propose or sign.
        </Notice>
      ) : !membership.isMember ? (
        <Notice>
          The wallet connected here is not one of this account’s members. You can watch it, but you cannot
          propose or sign — switch to a member’s wallet to do that.
        </Notice>
      ) : null}

      {/*
        The fingerprint is loud here and quiet everywhere else, because this is
        the moment it is for. Funding a multisig assembled from one wrong key
        produces a perfectly valid address whose contents nobody can ever move,
        and it is the only mistake on this screen that cannot be undone — so
        the check belongs in the sentence about sending money, not in a panel
        further down that everybody has stopped reading by their second week.
      */}
      {funded === false ? (
        <Notice>
          The chain has never seen this account. Send it some {DISPLAY_DENOM} first: until something arrives
          it has no account number, and a transaction signed without one can never be broadcast. Before
          anybody does, check that every member sees this same fingerprint —{' '}
          <code className="font-mono text-text">{fingerprintOf(config)}</code> — because a set with one wrong
          key in it is an address nobody holds.
        </Notice>
      ) : null}

      {balances.error ? (
        <p className="card px-4 py-3 text-base text-text-muted" role="alert">
          The {DISPLAY_DENOM} balance could not be read: {balances.error}
        </p>
      ) : null}

      {/*
        Balances and proposals side by side, in the places the wallet gives to
        balances and recent activity. They answer the same pair of questions a
        shared account has — what have we got, and what are we in the middle of
        doing with it — and stacking the second one puts a signing round below
        the fold of a list that grows.
      */}
      <div className={TWO_COLUMN}>
        <BalanceList
          balances={balances}
          mode="propose"
          onSend={(assetId) => propose('send', { asset: assetId })}
          onWrap={(contract) => propose('wrap', { contract })}
          onUnwrap={(contract) => propose('unwrap', { contract })}
          onStake={() => propose('stake')}
          onSignPermit={() => propose('viewing-key')}
        />

        <OpenProposals
          entries={proposals}
          threshold={config.threshold}
          you={walletAddress}
          isMember={membership.isMember}
        />
      </div>

      <div className={TWO_COLUMN}>
        <ViewingKeyCard
          hasKey={Boolean(keys)}
          contracts={keys?.contracts.length ?? 0}
          canPropose={membership.isMember}
          onPropose={() => propose('viewing-key')}
        />

        <MembersCard config={config} you={membership.member?.address} />
      </div>

      <AccountFooter
        config={config}
        onForget={() => {
          forgetMultisig(config.address)
          navigate('/wallet')
        }}
      />

      <ReceiveModal open={receiving} onClose={() => setReceiving(false)} address={config.address} />
    </div>
  )
}

/* -------------------------------------------------------------------------- */

/**
 * Who this account is, in the wallet's own header shape.
 *
 * The avatar is drawn from the address like any other — a multisig has no
 * picture to upload, because there is nobody whose picture it would be, so it
 * is the identicon and nothing else. The name is the group's own label, which
 * is local and says so by sitting above an address that is not.
 */
function Identity({
  config,
  isMember,
  connected,
  onPropose,
  onReceive
}: {
  config: MultisigConfig
  isMember: boolean
  connected: boolean
  onPropose: () => void
  onReceive: () => void
}) {
  const [copied, setCopied] = useState(false)

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // Clipboard access can be refused; the address is on screen to select.
    }
  }

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
      <Avatar address={config.address} />

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="min-w-0">
          <h1 className="text-display">{config.label}</h1>
          <p className="mt-0.5 text-base text-text-muted">
            {config.threshold} of {config.members.length} signatures
            {!connected ? '' : isMember ? ' · you are a member' : ' · you are not a member'}
          </p>
          <button
            type="button"
            onClick={() => void copy(config.address)}
            className="state-layer -ml-2 mt-1 flex max-w-full min-w-0 items-center gap-2 rounded-control py-1 pl-2 pr-2.5 text-base font-semibold text-text-faint"
          >
            {/*
              Never masked by the privacy toggle, unlike the wallet's. A
              multisig address is the thing members read to each other to
              establish they hold the same account, and hiding it would hide
              the one check this screen exists to make possible.
            */}
            <span className="block min-w-0 truncate md:hidden">
              {shortenAddress(config.address, 12, 6, { reveal: true })}
            </span>
            <span className="hidden min-w-0 truncate md:block">{config.address}</span>
            {copied ? (
              <Check size={15} aria-hidden className="shrink-0 text-positive" />
            ) : (
              <Copy size={15} aria-hidden className="shrink-0" />
            )}
            <span className="sr-only">{copied ? 'Address copied' : 'Copy address'}</span>
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="soft"
            shape="control"
            size="lg"
            icon={<Plus size={14} aria-hidden />}
            disabled={!isMember}
            onClick={onPropose}
          >
            Propose
          </Button>
          <Button
            variant="soft"
            shape="control"
            size="lg"
            icon={<ArrowDownToLine size={14} aria-hidden />}
            onClick={onReceive}
          >
            Receive
          </Button>
        </div>
      </div>
    </div>
  )
}

/**
 * What the group can spend, in the wallet's own words and type size.
 *
 * The native balance rather than the sum of everything held, for the same
 * reason as on the wallet: it is the figure that decides whether a proposal
 * can pay its own fee, which is the first thing a round of signatures runs
 * into when it is wrong.
 */
function AvailablePanel({
  native,
  nativeFiat,
  currency,
  loading,
  canPropose,
  onStake
}: {
  native?: string
  nativeFiat?: number
  currency: string
  loading: boolean
  canPropose: boolean
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
                {formatDisplayAmount(native)}{' '}
                <span className="text-title text-text-muted">{DISPLAY_DENOM}</span>
              </>
            )}
          </p>
        )}
        <p className="mt-0.5 text-label text-text-faint">{formatFiat(nativeFiat, currency)}</p>
      </div>

      <Button variant="soft" shape="control" disabled={!canPropose} onClick={onStake}>
        Stake
      </Button>
    </div>
  )
}

/**
 * What the group is in the middle of, in the column the wallet gives activity.
 *
 * Only what is still live: a broadcast proposal is history, and history has a
 * screen. Ordered newest first like the list behind it, and capped at three,
 * because a column beside a balance list is a glance and not a queue to work
 * through.
 */
function OpenProposals({
  entries,
  threshold,
  you,
  isMember
}: {
  entries: ProposalEntry[]
  threshold: number
  you?: string
  isMember: boolean
}) {
  const navigate = useNavigate()
  const open = entries.filter((entry) => !entry.receipt)
  const waiting = isMember ? open.filter((entry) => awaitsSignature(entry, you)).length : 0

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-2.5">
        <div className="flex items-baseline gap-2.5">
          <h2 className="text-title">Proposals</h2>
          {waiting > 0 ? <span className="text-label text-accent">{waiting} need you</span> : null}
        </div>
        {entries.length > 0 ? (
          <Button variant="text" size="sm" onClick={() => navigate('/multisig/proposals')}>
            See all
          </Button>
        ) : null}
      </div>

      {open.length === 0 ? (
        <p className="text-base text-text-muted">Nothing waiting for a signature.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {open.slice(0, 3).map((entry) => (
            <li key={entry.proposal.id}>
              <button
                type="button"
                onClick={() => navigate(`/multisig/proposals/${entry.proposal.id}`)}
                className="state-layer flex w-full flex-col gap-2 rounded-card border border-border p-3 text-left"
              >
                <span className="flex w-full items-center gap-2">
                  <StageBadge stage={stageOf(entry, threshold)} />
                  <span className="ml-auto shrink-0 text-label text-text-faint">
                    {ageLabel(entry.proposal.createdAt)}
                  </span>
                </span>
                <span className="w-full truncate text-base">{entry.proposal.title}</span>
                <span className="w-full">
                  <SignatureBar collected={entry.signatures.length} threshold={threshold} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="flex gap-2.5 rounded-card border border-border bg-surface p-4 text-base text-text-muted">
      <TriangleAlert size={16} className="mt-0.5 shrink-0 text-accent" />
      <span>{children}</span>
    </p>
  )
}

/**
 * The housekeeping, kept to one line.
 *
 * Three things that matter and are almost never wanted: the fingerprint to
 * read aloud, the configuration to send to a new member, and the way to take
 * this account off this browser. Each used to be a panel with a paragraph
 * under it, which put a third of the screen between the balances and nothing
 * anybody had come to do. The paragraphs are still here — as tooltips, and in
 * the case of the fingerprint, printed in full the one time it counts, in the
 * warning about funding an account the chain has never seen.
 */
function AccountFooter({ config, onForget }: { config: MultisigConfig; onForget: () => void }) {
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string>()

  const copyConfig = async () => {
    try {
      await navigator.clipboard.writeText(exportConfig(config))
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  const download = () => {
    const blob = new Blob([exportConfig(config)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${config.label.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'multisig'}.multisig.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-5">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-label text-text-faint">
        <span
          className="flex items-center gap-2"
          title="A hash of the member keys and the threshold. Two people reading it aloud are checking they hold the same account — worth doing before anybody funds it, because a set with one wrong key is an address nobody can spend from."
        >
          Fingerprint
          <code className="font-mono tracking-wide text-text-muted">{fingerprintOf(config)}</code>
        </span>

        <button
          type="button"
          onClick={() => void copyConfig()}
          title="Send this to the other members so they can add the same account. It holds public keys and a threshold — nothing that can move funds — plus the shared key their copy uses to talk to yours."
          className="flex items-center gap-1.5 underline underline-offset-4 hover:text-text-muted"
        >
          {copied ? <Check size={13} aria-hidden className="text-positive" /> : null}
          {copied ? 'Copied' : 'Copy the account'}
        </button>

        <button
          type="button"
          onClick={download}
          className="underline underline-offset-4 hover:text-text-muted"
        >
          Download it
        </button>

        <button
          type="button"
          onClick={onForget}
          title="Local only. The account itself cannot be deleted — it exists wherever its keys and threshold are known — and anything it holds stays where it is."
          className="flex items-center gap-1.5 underline underline-offset-4 hover:text-text-muted"
        >
          <Trash2 size={13} aria-hidden />
          Remove from this browser
        </button>
      </div>

      {error ? <p className="text-label text-negative">{error}</p> : null}
    </div>
  )
}

function MembersCard({ config, you }: { config: MultisigConfig; you?: string }) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-baseline gap-2.5">
        <h2 className="text-title">Members</h2>
        <span className="text-label text-text-faint">{config.members.length}</span>
      </div>
      <ul className="flex flex-col">
        {config.members.map((member, index) => (
          <li
            key={member.pubkey}
            className="flex items-center justify-between gap-3 border-b border-border py-2.5 last:border-b-0"
          >
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-base">
                {member.label || `Member ${index + 1}`}
                {member.address === you ? <span className="ml-2 text-label text-accent">you</span> : null}
              </span>
              <code className="truncate font-mono text-label text-text-faint">
                {shortenAddress(member.address, 14, 6, { reveal: true })}
              </code>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * Whether this account can read its own private balances yet.
 *
 * Said in full rather than shown as a toggle, because the trade is real: a
 * viewing key is a shared secret that outlives whoever it was shared with, and
 * setting one costs a round of signatures. Somebody deciding whether to do
 * that should be told what they are deciding.
 */
function ViewingKeyCard({
  hasKey,
  contracts,
  canPropose,
  onPropose
}: {
  hasKey: boolean
  contracts: number
  canPropose: boolean
  onPropose: () => void
}) {
  return (
    <section className="flex flex-col gap-1.5">
      <h2 className="flex items-center gap-2 text-title">
        <Eye size={16} className="text-text-muted" />
        {hasKey ? `Viewing key set on ${contracts} token${contracts === 1 ? '' : 's'}` : 'No viewing key yet'}
      </h2>
      {/*
        The full account of the trade while the group has not made it, and one
        line afterwards. Somebody deciding whether to spend a round of
        signatures on this should be told what they are deciding; somebody who
        decided last month does not need it explained again every time they
        look at their balances.
      */}
      <p className="text-label text-text-faint">
        {hasKey
          ? 'Anyone holding the key can read these balances, member or not — so removing a member means setting a new one.'
          : 'A multisig cannot use a query permit — those are verified against a single key, and this account has no single key. Private balances need a viewing key instead: the group signs one transaction to store it at each token, and every member can read the balance afterwards. It is a shared secret, so removing a member means setting a new one.'}
      </p>
      {canPropose ? (
        <div className="mt-1">
          <Button variant="secondary" size="sm" onClick={onPropose}>
            {hasKey ? 'Set it on more tokens' : 'Propose a viewing key'}
          </Button>
        </div>
      ) : null}
    </section>
  )
}

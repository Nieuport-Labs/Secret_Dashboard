import { Copy, Check, Eye, FileSignature, Plus, Trash2, TriangleAlert, Users } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

import Button from '@/components/ui/Button'
import EmptyState from '@/components/ui/EmptyState'
import { DECIMALS, DISPLAY_DENOM, DENOM } from '@/chains/secret4'
import { useBalances } from '@/hooks/useBalances'
import { errorMessage } from '@/lib/errors'
import { formatAmount, shortenAddress } from '@/lib/format'
import { fetchAccountMeta } from '@/lib/multisig/account'
import { exportConfig, fingerprintOf, type MultisigConfig } from '@/lib/multisig/config'
import { viewingKeyAuth } from '@/lib/snip20'
import { useProposalsFor } from '@/store/multisigProposals'
import { forgetMultisig, useActiveMultisigConfig, useMembership } from '@/store/multisig'
import { useAccountKeys } from '@/store/viewingKeys'
import { useWallet } from '@/store/wallet'
import TransportChip from './components/TransportChip'

/**
 * The account, and everything a member needs to know about it at a glance.
 *
 * Ordered by what goes wrong. First the address and its fingerprint, because
 * the one unrecoverable mistake with a multisig is sending money to the wrong
 * one. Then whether the chain has heard of it at all, because an unfunded
 * account cannot sign anything and that surprises every new group. Then the
 * balances, then the members, then the proposals in flight.
 */
export default function Multisig() {
  const navigate = useNavigate()
  const config = useActiveMultisigConfig()
  const membership = useMembership(config)
  const client = useWallet((state) => state.queryClient)
  const walletAddress = useWallet((state) => state.address)
  const keys = useAccountKeys(config?.address)
  const proposals = useProposalsFor(config?.address)

  const [funded, setFunded] = useState<boolean | undefined>()

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

  const open = proposals.filter((entry) => !entry.receipt)

  return (
    <div className="mx-auto flex max-w-[860px] flex-col gap-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-display">{config.label}</h1>
          <p className="text-base text-text-muted">
            {config.threshold} of {config.members.length} signatures
            {!walletAddress ? '' : membership.isMember ? ' · you are a member' : ' · you are not a member'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="soft"
            icon={<Plus size={16} />}
            onClick={() => navigate('/multisig/propose')}
            disabled={!membership.isMember}
          >
            Propose
          </Button>
        </div>
      </header>

      {!walletAddress ? (
        <Notice tone="warning">
          Nothing is connected, so this account can only be looked at. Connect a wallet that holds one of its
          member keys to propose or sign.
        </Notice>
      ) : !membership.isMember ? (
        <Notice tone="warning">
          The wallet connected here is not one of this account’s members. You can watch it, but you cannot
          propose or sign — switch to a member’s wallet to do that.
        </Notice>
      ) : null}

      {funded === false ? (
        <Notice tone="warning">
          The chain has never seen this account. Send it some {DISPLAY_DENOM} first: until something arrives
          it has no account number, and a transaction signed without one cannot be broadcast.
        </Notice>
      ) : null}

      <AddressCard config={config} />

      <section className="flex flex-col gap-3">
        <h2 className="text-title">Balances</h2>

        <div className="rounded-card border border-border">
          <Row
            label={DISPLAY_DENOM}
            detail="Public — anyone can see this"
            amount={balances.native ? formatAmount(balances.native, { decimals: DECIMALS }) : '—'}
          />
          {balances.publicBalances
            .filter((entry) => entry.denom !== DENOM)
            .map((entry) => (
              <Row
                key={entry.denom}
                label={entry.token?.symbol ?? entry.denom}
                detail="Public"
                amount={formatAmount(entry.amount, { decimals: entry.token?.decimals ?? 0 })}
              />
            ))}
          {balances.tokens.map((entry) => (
            <Row
              key={entry.token.address}
              label={entry.token.symbol}
              detail={entry.outcome.status === 'ok' ? 'Private — read with the viewing key' : undefined}
              amount={
                entry.outcome.status === 'ok'
                  ? formatAmount(entry.outcome.amount, { decimals: entry.token.decimals })
                  : entry.outcome.status === 'unauthorized'
                    ? 'Key rejected'
                    : 'Unavailable'
              }
            />
          ))}
        </div>

        <ViewingKeyCard
          hasKey={Boolean(keys)}
          contracts={keys?.contracts.length ?? 0}
          canPropose={membership.isMember}
        />
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-title">Proposals</h2>
          {proposals.length > 0 ? (
            <Button variant="text" size="sm" onClick={() => navigate('/multisig/proposals')}>
              See all
            </Button>
          ) : null}
        </div>

        {open.length === 0 ? (
          <p className="rounded-card border border-border p-4 text-base text-text-muted">
            Nothing waiting for a signature.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {open.slice(0, 3).map((entry) => (
              <li key={entry.proposal.id}>
                <button
                  type="button"
                  onClick={() => navigate(`/multisig/proposals/${entry.proposal.id}`)}
                  className="state-layer flex w-full items-center gap-3 rounded-card border border-border p-3 text-left"
                >
                  <FileSignature size={16} className="shrink-0 text-text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base">{entry.proposal.title}</span>
                    <span className="text-label text-text-faint">
                      {entry.signatures.length} of {config.threshold} signatures
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <MembersCard config={config} you={membership.member?.address} />

      <section className="flex flex-col gap-3">
        <h2 className="text-title">Sharing and removing</h2>
        <TransportChip />
        <ExportCard config={config} />
        <div>
          <Button
            variant="ghost"
            size="sm"
            icon={<Trash2 size={15} />}
            onClick={() => {
              forgetMultisig(config.address)
              navigate('/wallet')
            }}
          >
            Remove from this browser
          </Button>
          <p className="mt-1 text-label text-text-faint">
            Local only. The account itself cannot be deleted — it exists wherever its keys and threshold are
            known — and anything it holds stays where it is.
          </p>
        </div>
      </section>
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function Notice({ tone, children }: { tone: 'warning'; children: ReactNode }) {
  return (
    <p
      className={
        tone === 'warning'
          ? 'flex gap-2.5 rounded-card border border-border bg-surface p-4 text-base text-text-muted'
          : ''
      }
    >
      <TriangleAlert size={16} className="mt-0.5 shrink-0 text-accent" />
      <span>{children}</span>
    </p>
  )
}

function Row({ label, detail, amount }: { label: string; detail?: string; amount: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 last:border-b-0">
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-base">{label}</span>
        {detail ? <span className="text-label text-text-faint">{detail}</span> : null}
      </span>
      <span className="shrink-0 font-mono text-base">{amount}</span>
    </div>
  )
}

function AddressCard({ config }: { config: MultisigConfig }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(config.address)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // The address is on screen and selectable; a refused clipboard is not an error.
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-label text-text-muted">Address</span>
          <code className="break-all font-mono text-base">{config.address}</code>
        </div>
        <Button
          variant="ghost"
          size="sm"
          icon={copied ? <Check size={15} /> : <Copy size={15} />}
          onClick={copy}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-label text-text-muted">Fingerprint</span>
        <code className="font-mono text-base tracking-wide">{fingerprintOf(config)}</code>
        <span className="text-label text-text-faint">
          Every member should see the same code here. It covers the member keys and the threshold, so two
          people reading it aloud are checking they hold the same account.
        </span>
      </div>
    </section>
  )
}

function MembersCard({ config, you }: { config: MultisigConfig; you?: string }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-title">Members</h2>
      <ul className="rounded-card border border-border">
        {config.members.map((member, index) => (
          <li
            key={member.pubkey}
            className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 last:border-b-0"
          >
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-base">
                {member.label || `Member ${index + 1}`}
                {member.address === you ? <span className="ml-2 text-label text-accent">you</span> : null}
              </span>
              <code className="truncate font-mono text-label text-text-faint">
                {shortenAddress(member.address, 16, 8)}
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
  canPropose
}: {
  hasKey: boolean
  contracts: number
  canPropose: boolean
}) {
  const navigate = useNavigate()

  return (
    <div className="flex flex-col gap-2 rounded-card border border-border p-4">
      <span className="flex items-center gap-2 text-base">
        <Eye size={16} className="text-text-muted" />
        {hasKey ? `Viewing key set on ${contracts} token${contracts === 1 ? '' : 's'}` : 'No viewing key yet'}
      </span>
      <p className="text-label text-text-faint">
        A multisig cannot use a query permit — those are verified against a single key, and this account has
        no single key. Private balances need a viewing key instead: the group signs one transaction to store
        it at each token, and every member can read the balance afterwards. It is a shared secret, so removing
        a member means setting a new one.
      </p>
      {canPropose ? (
        <div>
          <Button
            variant="text"
            size="sm"
            onClick={() => navigate('/multisig/propose', { state: { preset: 'viewing-key' } })}
          >
            {hasKey ? 'Set it on more tokens' : 'Propose a viewing key'}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function ExportCard({ config }: { config: MultisigConfig }) {
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string>()

  const copy = async () => {
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
    <div className="flex flex-col gap-2 rounded-card border border-border p-4">
      <p className="text-base text-text-muted">
        Send this to the other members so they can add the same account. It holds public keys and a threshold
        — nothing that can move funds — plus the shared key their copy uses to talk to yours.
      </p>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="sm"
          icon={copied ? <Check size={15} /> : <Copy size={15} />}
          onClick={copy}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button variant="secondary" size="sm" onClick={download}>
          Download
        </Button>
      </div>
      {error ? <p className="text-label text-negative">{error}</p> : null}
    </div>
  )
}

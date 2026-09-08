import { KeyRound, Pencil, Server, ShieldAlert, Wallet } from 'lucide-react'
import { useState } from 'react'

import Button from '@/components/ui/Button'
import EmptyState from '@/components/ui/EmptyState'
import { DISPLAY_DENOM, explorerTxUrl } from '@/chains/secret4'
import { useValidatorAccount } from '@/hooks/useValidatorAccount'
import { useValidatorAdmin } from '@/hooks/useValidatorAdmin'
import { useValidatorAuthority } from '@/hooks/useValidatorAuthority'
import { formatDisplayAmount, shortenAddress } from '@/lib/format'
import { MSG_EDIT_VALIDATOR, MSG_UNJAIL, MSG_WITHDRAW_COMMISSION } from '@/lib/msgTypes'
import { shareOfBonded } from '@/lib/staking'
import EditValidatorModal from '@/pages/validator/components/EditValidatorModal'
import PermissionsModal from '@/pages/validator/components/PermissionsModal'
import ValidatorIdentity from '@/pages/validator/components/ValidatorIdentity'
import { useActiveValidator } from '@/store/accounts'
import { useWallet } from '@/store/wallet'

/**
 * The validator's own screen — what it is, and the three things that can be
 * changed about it.
 *
 * Who may change them is a question about permission rather than about which
 * key is plugged in. The operator's own wallet may do everything; another
 * wallet may do whatever the operator has granted it and nothing more. Each
 * button asks that question for itself, so a wallet granted only the vote is
 * not told it may unjail.
 */
export default function Validator() {
  const active = useActiveValidator()
  const address = useWallet((state) => state.address)
  const valoper = active?.account.valoper
  const data = useValidatorAccount(valoper)
  const admin = useValidatorAdmin(valoper ?? '', data.refresh)
  const authority = useValidatorAuthority()

  const [editing, setEditing] = useState(false)
  const [managing, setManaging] = useState(false)

  if (!active) return null

  if (data.error) {
    return <EmptyState icon={Server} title="Could not read this validator" description={data.error} />
  }

  if (!data.detail) {
    return <p className="text-base text-text-muted">Loading {active.account.moniker}…</p>
  }

  const detail = data.detail
  const share = shareOfBonded(detail, data.totalBonded)
  const commission = data.outstandingCommission

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-8">
      <ValidatorIdentity
        detail={detail}
        canOperate={active.canOperate}
        onManagePermissions={!authority.direct && address ? () => setManaging(true) : undefined}
      />

      <div className="card grid divide-y divide-border overflow-hidden sm:grid-cols-2 sm:divide-x lg:grid-cols-3 [&>*:nth-child(-n+2)]:sm:border-t-0">
        <Stat
          label="Voting power"
          value={`${formatDisplayAmount(detail.tokens)} ${DISPLAY_DENOM}`}
          note={share === undefined ? 'not in the bonded set' : `${(share * 100).toFixed(2)}% of bonded`}
        />
        <Stat
          label="Commission"
          value={`${(detail.commission * 100).toFixed(2)}%`}
          note={`max ${(detail.maxRate * 100).toFixed(0)}%, moves up to ${(detail.maxChangeRate * 100).toFixed(2)}% a day`}
        />
        <Stat
          label="Self-bonded"
          value={`${formatDisplayAmount(data.selfDelegation)} ${DISPLAY_DENOM}`}
          note={`minimum ${formatDisplayAmount(detail.minSelfDelegation)} ${DISPLAY_DENOM}`}
        />
        <Stat
          label="Delegators"
          value={data.delegators === undefined ? 'Unavailable' : data.delegators.toLocaleString()}
        />
        <Stat
          label="Unclaimed commission"
          value={`${formatDisplayAmount(commission)} ${DISPLAY_DENOM}`}
          note="SCRT only"
        />
        <Stat
          label="Missed blocks"
          value={data.signing === undefined ? 'Unavailable' : data.signing.missedBlocks.toLocaleString()}
          note={
            data.signing === undefined
              ? 'signing record could not be read'
              : `of a ${data.signing.signedBlocksWindow.toLocaleString()} block window`
          }
        />
      </div>

      {detail.details ? (
        <section className="card p-5">
          <h2 className="text-label text-text-muted">Description</h2>
          <p className="mt-2 text-balance text-base">{detail.details}</p>
        </section>
      ) : null}

      <section className="card flex flex-col gap-4 p-5">
        <div>
          <h2 className="text-title">Operations</h2>
          <p className="mt-1 text-base text-text-muted">
            {!address
              ? 'Connect a wallet to act on this validator.'
              : authority.direct
                ? `Signed by ${shortenAddress(authority.operator ?? '')}, the account that operates this validator.`
                : 'Sent by this wallet on the validator’s behalf, under the permissions its operator granted.'}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {/* First, because when nothing is granted it is the only one that
              does anything — the rest are disabled until it has been used. */}
          {!authority.direct && address ? (
            <Button
              variant="soft"
              shape="control"
              icon={<KeyRound size={16} aria-hidden />}
              onClick={() => setManaging(true)}
            >
              Permissions
            </Button>
          ) : null}
          <Button
            variant="soft"
            shape="control"
            icon={<Pencil size={16} aria-hidden />}
            disabled={!authority.allows(MSG_EDIT_VALIDATOR)}
            title={authority.allows(MSG_EDIT_VALIDATOR) ? undefined : NOT_PERMITTED}
            onClick={() => setEditing(true)}
          >
            Edit validator
          </Button>
          <Button
            variant="soft"
            shape="control"
            icon={<Wallet size={16} aria-hidden />}
            loading={admin.state.kind === 'sending'}
            disabled={commission === '0' || !authority.allows(MSG_WITHDRAW_COMMISSION)}
            title={
              !authority.allows(MSG_WITHDRAW_COMMISSION)
                ? NOT_PERMITTED
                : commission === '0'
                  ? 'Nothing has accrued yet'
                  : undefined
            }
            onClick={() => void admin.withdrawCommission()}
          >
            Withdraw {formatDisplayAmount(commission)} {DISPLAY_DENOM}
          </Button>
          {detail.jailed ? (
            <Button
              variant="secondary"
              shape="control"
              icon={<ShieldAlert size={16} aria-hidden />}
              loading={admin.state.kind === 'sending'}
              disabled={data.signing?.tombstoned || !authority.allows(MSG_UNJAIL)}
              title={
                !authority.allows(MSG_UNJAIL)
                  ? NOT_PERMITTED
                  : data.signing?.tombstoned
                    ? 'Tombstoned validators cannot be unjailed'
                    : undefined
              }
              onClick={() => void admin.unjail()}
            >
              Unjail
            </Button>
          ) : null}
        </div>

        {detail.jailed && data.signing?.jailedUntil && data.signing.jailedUntil > new Date() ? (
          <p className="text-base text-text-muted">
            The chain will refuse an unjail until {data.signing.jailedUntil.toLocaleString()}.
          </p>
        ) : null}

        {admin.state.kind === 'failed' ? (
          <p className="break-address text-base text-negative" role="alert">
            {admin.state.message}
          </p>
        ) : null}
        {admin.state.kind === 'done' ? (
          <p className="text-base text-text-muted">
            Sent.{' '}
            <a
              href={explorerTxUrl(admin.state.hash)}
              target="_blank"
              rel="noreferrer"
              className="text-accent"
            >
              View the transaction
            </a>
          </p>
        ) : null}
      </section>

      <EditValidatorModal open={editing} onClose={() => setEditing(false)} detail={detail} admin={admin} />

      {address ? (
        <PermissionsModal
          open={managing}
          onClose={() => setManaging(false)}
          authority={authority}
          grantee={address}
        />
      ) : null}
    </div>
  )
}

/** Said on the disabled control itself, where the reason is actually looked for. */
const NOT_PERMITTED = 'The validator’s operator has not granted this wallet permission for this'

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="p-5">
      <p className="text-label text-text-muted">{label}</p>
      <p className="mt-1.5 text-headline tabular-nums">{value}</p>
      {note ? <p className="mt-1 text-label text-text-faint">{note}</p> : null}
    </div>
  )
}

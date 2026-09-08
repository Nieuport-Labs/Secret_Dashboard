import { ChevronRight, RefreshCw, ShieldCheck, X } from 'lucide-react'
import { useState } from 'react'

import Button from '@/components/ui/Button'
import CommandBlock from '@/components/ui/CommandBlock'
import Modal from '@/components/ui/Modal'
import {
  VALIDATOR_PERMISSIONS,
  grantCommand,
  grantExpiry,
  revokeCommand,
  type Permission
} from '@/lib/authz'
import type { ValidatorAuthority } from '@/hooks/useValidatorAuthority'

interface Props {
  open: boolean
  onClose: () => void
  authority: ValidatorAuthority
  /** The wallet these permissions would be granted to. */
  grantee: string
}

/**
 * What the operator has to run for this wallet to act on the validator's behalf.
 *
 * The dashboard cannot issue these grants itself — that is the whole point of
 * them, since issuing one requires the very key the person at this screen does
 * not have. So the honest thing to offer is the exact command, addressed to this
 * wallet, ready to paste into a terminal that does hold the key.
 *
 * Two steps rather than one. The list answers "what am I allowed to do", which
 * is glanced at; the command answers "how do I change that", which is worked
 * through once. Four shell commands stacked in one dialog turns the first
 * question into a scroll.
 */
export default function PermissionsModal({ open, onClose, authority, grantee }: Props) {
  const [expiry] = useState(() => grantExpiry())
  const [selected, setSelected] = useState<Permission | undefined>()
  const granter = authority.operator

  if (!granter) return null

  // Reopening should start at the list. Leaving the flow half-drilled means the
  // next open answers a question nobody asked this time.
  const close = () => {
    setSelected(undefined)
    onClose()
  }

  if (selected) {
    return (
      <PermissionDetail
        open={open}
        onClose={close}
        onBack={() => setSelected(undefined)}
        permission={selected}
        authority={authority}
        granter={granter}
        grantee={grantee}
        expiry={expiry}
      />
    )
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Permissions"
      description="This wallet is not the validator’s operator, so the chain only accepts what the operator has explicitly allowed."
    >
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-label">
        <dt className="text-text-muted">Operator</dt>
        <dd className="break-address font-mono">{granter}</dd>
        <dt className="text-text-muted">This wallet</dt>
        <dd className="break-address font-mono">{grantee}</dd>
      </dl>

      <ul className="flex flex-col gap-2">
        {VALIDATOR_PERMISSIONS.map((permission) => {
          const grant = authority.grants.get(permission.msgType)
          return (
            <li key={permission.msgType}>
              <button
                type="button"
                onClick={() => setSelected(permission)}
                className="state-layer flex w-full items-center gap-3 rounded-control border border-border p-3 text-left"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-medium">{permission.label}</span>
                  <span className="mt-0.5 block text-label text-text-muted">
                    {permission.description}
                  </span>
                  <Status grant={grant} granted={authority.grants.has(permission.msgType)} />
                </span>
                <ChevronRight size={16} aria-hidden className="shrink-0 text-text-faint" />
              </button>
            </li>
          )
        })}
      </ul>

      <p className="text-label text-text-faint">
        Each permission hands over one thing and nothing else. None of them can spend the validator’s
        stake or move its delegations.
      </p>
    </Modal>
  )
}

/** The status line, shared by both steps so they cannot word it differently. */
function Status({ grant, granted }: { grant?: { expiration?: Date }; granted: boolean }) {
  if (!granted) {
    return (
      <span className="mt-1.5 flex items-center gap-1.5 text-label text-text-faint">
        <X size={14} aria-hidden />
        Not granted
      </span>
    )
  }

  return (
    <span className="mt-1.5 flex items-center gap-1.5 text-label text-accent">
      <ShieldCheck size={14} aria-hidden />
      {grant?.expiration ? `Granted until ${grant.expiration.toLocaleDateString()}` : 'Granted'}
    </span>
  )
}

interface DetailProps {
  open: boolean
  onClose: () => void
  onBack: () => void
  permission: Permission
  authority: ValidatorAuthority
  granter: string
  grantee: string
  expiry: Date
}

/**
 * One permission: what it is, whether it is held, and the command that changes
 * that — granting it when it is missing, taking it back when it is held.
 */
function PermissionDetail({
  open,
  onClose,
  onBack,
  permission,
  authority,
  granter,
  grantee,
  expiry
}: DetailProps) {
  const granted = authority.grants.has(permission.msgType)
  const grant = authority.grants.get(permission.msgType)

  return (
    <Modal
      open={open}
      onClose={onClose}
      onBack={onBack}
      title={permission.label}
      description={permission.description}
    >
      <div
        className={
          granted
            ? 'rounded-control bg-accent-container p-3 text-base text-accent'
            : 'rounded-control border border-negative p-3 text-base text-negative'
        }
        role="status"
      >
        {granted
          ? grant?.expiration
            ? `Granted to this wallet until ${grant.expiration.toLocaleString()}.`
            : 'Granted to this wallet, with no expiry.'
          : 'Not granted. Until the operator runs the command below, the chain will refuse this.'}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-label text-text-muted">
          {granted ? 'Command to take it back' : 'Command to allow it'}
        </h3>
        <CommandBlock
          label={`command to ${granted ? 'revoke' : 'allow'} ${permission.label.toLowerCase()}`}
          command={
            granted
              ? revokeCommand(granter, grantee, permission.msgType)
              : grantCommand(granter, grantee, permission.msgType, expiry)
          }
        />
        <p className="text-label text-text-faint">
          Run it where the validator’s operator key lives — it is signed by{' '}
          <span className="break-address font-mono">{granter}</span>, not by this wallet.
          {granted ? null : (
            <>
              {' '}
              Change <code className="font-mono">--expiration</code> to move the date it lapses.
            </>
          )}
        </p>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
        <span className="text-base text-text-muted">
          {granted ? 'Permission found' : 'Permission not found'}
        </span>
        <Button
          variant="soft"
          shape="control"
          icon={<RefreshCw size={16} aria-hidden />}
          loading={authority.loading}
          onClick={authority.refresh}
        >
          Check
        </Button>
      </div>
    </Modal>
  )
}

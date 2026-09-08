import { ExternalLink, KeyRound, MoreHorizontal, Trash2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import Menu, { MenuItem } from '@/components/ui/Menu'
import { explorerValidatorUrl } from '@/chains/secret4'
import { useValidatorProfile } from '@/hooks/useValidatorProfile'
import { cn } from '@/lib/cn'
import { shortenAddress } from '@/lib/format'
import type { ValidatorDetail } from '@/lib/validator'
import ValidatorAvatar from '@/pages/staking/components/ValidatorAvatar'
import { useAccounts } from '@/store/accounts'

interface Props {
  detail: ValidatorDetail
  /** The wallet on screen operates this validator, rather than watching it. */
  canOperate: boolean
  /**
   * Opens the grants dialog. Absent on a screen that has no dialog to open —
   * the operator's own, where nothing needs granting, and the stats screen,
   * which owns no permission state.
   */
  onManagePermissions?: () => void
}

/**
 * Who this page is about, shown the same way on both validator screens.
 *
 * The bonding state is a badge rather than a line of prose because it is the
 * one fact that changes what the rest of the page means: a jailed validator's
 * voting power is not power, and its commission is not accruing.
 */
export default function ValidatorIdentity({ detail, canOperate, onManagePermissions }: Props) {
  const navigate = useNavigate()
  const profile = useValidatorProfile(detail.identity)
  const remove = useAccounts((state) => state.remove)

  /*
   * Removing drops the account from the switcher and nothing else — no stake
   * moves, no key is touched, and adding it back costs one search. That is why
   * it goes ahead without a confirmation step: an undoable local change does
   * not earn a dialog.
   *
   * The store clears the active account when the removed one was it, which
   * leaves validator mode; the wallet screen is where that lands.
   */
  const removeAccount = () => {
    remove(detail.address)
    navigate('/wallet')
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      <ValidatorAvatar address={detail.address} moniker={detail.moniker} image={profile?.image} size={52} />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-display">{detail.moniker}</h1>
          <StatusBadge detail={detail} />
          {canOperate ? null : <Badge tone="muted">Watching</Badge>}
        </div>

        <a
          href={explorerValidatorUrl(detail.address)}
          target="_blank"
          rel="noreferrer"
          className="state-layer mt-1 inline-flex items-center gap-1.5 rounded-control text-label text-text-muted"
        >
          {shortenAddress(detail.address, 16, 6)}
          <ExternalLink size={12} aria-hidden />
        </a>
      </div>

      <Menu
        label={`Account actions for ${detail.moniker}`}
        triggerClassName="rounded-pill border border-border p-2 text-text-muted"
        trigger={<MoreHorizontal size={16} aria-hidden />}
      >
        {onManagePermissions ? (
          <MenuItem icon={<KeyRound size={16} aria-hidden />} onClick={onManagePermissions}>
            Manage permissions
          </MenuItem>
        ) : null}
        <MenuItem icon={<Trash2 size={16} aria-hidden />} onClick={removeAccount}>
          Remove this account
        </MenuItem>
      </Menu>
    </div>
  )
}

function StatusBadge({ detail }: { detail: ValidatorDetail }) {
  if (detail.jailed) return <Badge tone="danger">Jailed</Badge>
  if (detail.status === 'BOND_STATUS_BONDED') return <Badge tone="ok">Active</Badge>
  if (detail.status === 'BOND_STATUS_UNBONDING') return <Badge tone="warn">Unbonding</Badge>
  return <Badge tone="muted">Inactive</Badge>
}

const TONES = {
  ok: 'bg-accent-container text-accent',
  warn: 'border border-border text-text',
  danger: 'border border-negative text-negative',
  muted: 'border border-border text-text-muted'
} as const

export function Badge({ tone, children }: { tone: keyof typeof TONES; children: string }) {
  return (
    <span className={cn('rounded-pill px-2.5 py-1 text-label font-medium', TONES[tone])}>{children}</span>
  )
}

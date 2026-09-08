import { Check, ChevronDown, LogOut, Plus, Settings as SettingsIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import AddAccountModal from '@/components/accounts/AddAccountModal'
import AddValidatorModal from '@/components/accounts/AddValidatorModal'
import Menu, { MenuItem } from '@/components/ui/Menu'
import { useValidatorProfile } from '@/hooks/useValidatorProfile'
import { shortenAddress } from '@/lib/format'
import { queryValidator } from '@/lib/staking'
import ValidatorAvatar from '@/pages/staking/components/ValidatorAvatar'
import { useAccounts, useActiveValidator, type LinkedAccount } from '@/store/accounts'
import { useWallet } from '@/store/wallet'

interface Props {
  onOpenSettings: () => void
}

/**
 * The account on screen, and the menu that changes which one that is
 * (Figma 34:668).
 *
 * Every account here is signed for by the same wallet — a validator is a hat,
 * not a second key — so switching never disconnects anything. What it does
 * change is the whole shell around it, which is why the switch lives on the
 * identity in the header rather than somewhere in settings.
 */
export default function WalletChip({ onOpenSettings }: Props) {
  const navigate = useNavigate()
  const address = useWallet((state) => state.address)
  const accountName = useWallet((state) => state.accountName)
  const disconnect = useWallet((state) => state.disconnect)

  const accounts = useAccounts((state) => state.accounts)
  const setActive = useAccounts((state) => state.setActive)
  const clearActive = useAccounts((state) => state.clearActive)
  const active = useActiveValidator()

  const [choosingKind, setChoosingKind] = useState(false)
  const [addingValidator, setAddingValidator] = useState(false)

  if (!address) return null

  const switchToWallet = () => {
    clearActive()
    navigate('/wallet')
  }

  const switchToValidator = (valoper: string) => {
    setActive(valoper)
    navigate('/validator')
  }

  return (
    <>
      <Menu
        label="Account menu"
        triggerClassName="flex items-center gap-2 rounded-pill border border-border px-2.5 py-1.5 text-base font-medium"
        trigger={
          active ? (
            <>
              <AccountAvatar account={active.account} size={16} />
              <span className="max-w-[140px] truncate">{active.account.moniker}</span>
              <ChevronDown size={14} aria-hidden className="text-text-muted" />
            </>
          ) : (
            <>
              <img src="/img/secret-mark.svg" alt="" className="h-4 w-4 shrink-0" />
              <span className="whitespace-nowrap">{shortenAddress(address)}</span>
              <ChevronDown size={14} aria-hidden className="text-text-muted" />
            </>
          )
        }
        className="min-w-[240px]"
      >
        <MenuItem
          icon={<img src="/img/secret-mark.svg" alt="" className="h-4 w-4 shrink-0" />}
          onClick={switchToWallet}
        >
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate">{accountName ?? 'Wallet'}</span>
            <span className="text-label text-text-faint">{shortenAddress(address)}</span>
          </span>
          {active ? null : <Check size={15} aria-hidden className="ml-2 shrink-0 text-accent" />}
        </MenuItem>

        {accounts.map((account) => (
          <MenuItem
            key={account.valoper}
            icon={<AccountAvatar account={account} size={16} />}
            onClick={() => switchToValidator(account.valoper)}
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="max-w-[150px] truncate">{account.moniker}</span>
              <span className="text-label text-text-faint">
                {account.operator ? 'Validator' : 'Validator · watching'}
              </span>
            </span>
            {active?.account.valoper === account.valoper ? (
              <Check size={15} aria-hidden className="ml-2 shrink-0 text-accent" />
            ) : null}
          </MenuItem>
        ))}

        <MenuItem icon={<Plus size={16} aria-hidden />} onClick={() => setChoosingKind(true)}>
          Add
        </MenuItem>

        <hr className="my-1 border-border" />

        <MenuItem icon={<SettingsIcon size={16} aria-hidden />} onClick={onOpenSettings}>
          Settings
        </MenuItem>
        <MenuItem icon={<LogOut size={16} aria-hidden />} onClick={disconnect}>
          Disconnect
        </MenuItem>
      </Menu>

      <AddAccountModal
        open={choosingKind}
        onClose={() => setChoosingKind(false)}
        onChooseValidator={() => {
          setChoosingKind(false)
          setAddingValidator(true)
        }}
      />
      <AddValidatorModal open={addingValidator} onClose={() => setAddingValidator(false)} />
    </>
  )
}

/**
 * A linked account's own picture, falling back to the generated one.
 *
 * Its own component because the lookups are hooks and the switcher renders one
 * row per account. The Keybase result is cached, so a validator's row and the
 * chip beside it fetch once between them.
 */
function AccountAvatar({ account, size }: { account: LinkedAccount; size: number }) {
  const identity = useStoredIdentity(account)
  const profile = useValidatorProfile(identity)

  return (
    <ValidatorAvatar
      address={account.valoper}
      moniker={account.moniker}
      image={profile?.image}
      size={size}
    />
  )
}

/**
 * The account's Keybase identity, fetched once for accounts that predate it
 * being recorded and written back so it is never fetched again.
 *
 * Backfilled rather than left to the user to fix by removing and re-adding the
 * account: they have no way of knowing that is what a missing picture means.
 * The result is stored either way — a validator that published no identity
 * records an empty string, which is what stops this asking again every render.
 */
function useStoredIdentity(account: LinkedAccount): string | undefined {
  const client = useWallet((state) => state.queryClient)
  const setIdentity = useAccounts((state) => state.setIdentity)
  const { valoper, identity } = account

  useEffect(() => {
    if (identity !== undefined || !client) return

    let cancelled = false
    void queryValidator(client, valoper)
      .then((validator) => {
        if (!cancelled && validator) setIdentity(valoper, validator.identity ?? '')
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [client, valoper, identity, setIdentity])

  return identity || undefined
}

import { Check, ChevronDown, LogOut, Plus, Settings as SettingsIcon, UserRound, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import AddAccountModal from '@/components/accounts/AddAccountModal'
import AddValidatorModal from '@/components/accounts/AddValidatorModal'
import Menu, { MenuItem } from '@/components/ui/Menu'
import ProfileModal from '@/components/wallet/ProfileModal'
import { useProfileIdentity } from '@/hooks/useProfileIdentity'
import { useValidatorProfile } from '@/hooks/useValidatorProfile'
import { shortenAddress } from '@/lib/format'
import { hueFor } from '@/lib/identicon'
import { queryValidator } from '@/lib/staking'
import ValidatorAvatar from '@/pages/staking/components/ValidatorAvatar'
import {
  displayName,
  useAccounts,
  useActiveAccount,
  type LinkedAccount,
  type LinkedValidator
} from '@/store/accounts'
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
 *
 * The chip is two controls in one border, and the split is the point. Pressing
 * the identity opens the profile, which is what someone pointing at their own
 * name and picture is reaching for; the menu is behind the chevron, which is
 * what a chevron has always promised. One button doing both meant the common
 * intention — "let me look at me" — had no way of being expressed at all.
 */
export default function WalletChip({ onOpenSettings }: Props) {
  const navigate = useNavigate()
  const address = useWallet((state) => state.address)
  const accountName = useWallet((state) => state.accountName)
  const disconnect = useWallet((state) => state.disconnect)

  const accounts = useAccounts((state) => state.accounts)
  const setActive = useAccounts((state) => state.setActive)
  const clearActive = useAccounts((state) => state.clearActive)
  const active = useActiveAccount()

  const [choosingKind, setChoosingKind] = useState(false)
  const [addingValidator, setAddingValidator] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)

  // The published picture, not the local one: the header should show what
  // everybody else sees, so a profile that looks right here looks right to the
  // person who was sent the link.
  const identity = useProfileIdentity(address ?? '')

  if (!address) return null

  const switchToWallet = () => {
    clearActive()
    navigate('/wallet')
  }

  const switchTo = (account: LinkedAccount) => {
    setActive(account.id)
    navigate(account.kind === 'validator' ? '/validator' : '/multisig')
  }

  return (
    <>
      <div className="flex items-stretch rounded-control border border-border">
        {/*
          Name over address, the same two lines the menu shows for this account.
          The chip used to show one or the other — the wallet's address with no
          name, a validator's moniker with no address — so the strip never quite
          answered "which account is this, and is it the one I meant". Both
          lines cost one row of header height and settle it.
        */}
        <button
          type="button"
          onClick={() => setProfileOpen(true)}
          className="state-layer flex items-center gap-2 rounded-l-control py-1.5 pl-2.5 pr-2 text-base font-medium"
        >
          {active?.kind === 'validator' ? (
            <>
              <AccountAvatar account={active} size={22} />
              <Identity name={active.moniker} address={active.valoper} />
            </>
          ) : active?.kind === 'multisig' ? (
            <>
              <MultisigAvatar address={active.address} size={22} />
              <Identity name={active.label} address={active.address} />
            </>
          ) : (
            <>
              <ChipAvatar url={identity.avatarUrl} />
              {/* The published name wins over the one the wallet extension
                  calls this key: the profile is the account's own answer to
                  "who is this", and the extension's label is a local nickname
                  nobody else can see. */}
              <Identity name={identity.name ?? accountName ?? 'Wallet'} address={address} />
            </>
          )}
        </button>

        <Menu
          label="Account menu"
          triggerClassName="flex h-full items-center rounded-r-control px-1.5 text-text-muted"
          trigger={<ChevronDown size={14} aria-hidden />}
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
              key={account.id}
              icon={
                account.kind === 'validator' ? (
                  <AccountAvatar account={account} size={16} />
                ) : (
                  <MultisigAvatar address={account.address} size={16} />
                )
              }
              onClick={() => switchTo(account)}
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="max-w-[150px] truncate">{displayName(account)}</span>
                <span className="text-label text-text-faint">
                  {account.kind === 'multisig'
                    ? `Multisig · ${account.threshold} of ${account.memberCount}`
                    : account.operator
                      ? 'Validator'
                      : 'Validator · watching'}
                </span>
              </span>
              {active?.id === account.id ? (
                <Check size={15} aria-hidden className="ml-2 shrink-0 text-accent" />
              ) : null}
            </MenuItem>
          ))}

          <MenuItem icon={<Plus size={16} aria-hidden />} onClick={() => setChoosingKind(true)}>
            Add
          </MenuItem>

          <hr className="my-1 border-border" />

          {/* Also in the menu, not only behind the identity. The split trigger is
            worth having and still has to be discovered, and a profile that can
            only be reached by guessing might as well not be there. */}
          <MenuItem icon={<UserRound size={16} aria-hidden />} onClick={() => setProfileOpen(true)}>
            Profile
          </MenuItem>
          <MenuItem icon={<SettingsIcon size={16} aria-hidden />} onClick={onOpenSettings}>
            Settings
          </MenuItem>
          <MenuItem icon={<LogOut size={16} aria-hidden />} onClick={disconnect}>
            Disconnect
          </MenuItem>
        </Menu>
      </div>

      <ProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} address={address} />

      <AddAccountModal
        open={choosingKind}
        onClose={() => setChoosingKind(false)}
        onChooseValidator={() => {
          setChoosingKind(false)
          setAddingValidator(true)
        }}
        onChooseMultisig={() => {
          setChoosingKind(false)
          navigate('/multisig/new')
        }}
      />
      <AddValidatorModal open={addingValidator} onClose={() => setAddingValidator(false)} />
    </>
  )
}

/**
 * The two lines the chip and the menu agree on: what this account is called,
 * and the address that call sign belongs to.
 *
 * The address is the smaller, quieter line on purpose. It is the part you check
 * rather than the part you read, and it is the only one of the two that cannot
 * be wrong.
 */
function Identity({ name, address }: { name: string; address: string }) {
  return (
    <span className="flex min-w-0 flex-col items-start leading-tight">
      <span className="max-w-[150px] truncate">{name}</span>
      <span className="max-w-[150px] truncate text-label font-normal text-text-faint">
        {shortenAddress(address)}
      </span>
    </span>
  )
}

/**
 * A multisig has no picture and no Keybase identity — it is an address and a
 * set of members. A colour derived from the address is enough to tell two
 * apart in a list, which is all this has to do.
 */
function MultisigAvatar({ address, size }: { address: string; size: number }) {
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-pill text-label font-medium text-white"
      style={{ width: size, height: size, backgroundColor: `hsl(${hueFor(address)} 45% 45%)` }}
    >
      <Users size={Math.round(size * 0.55)} strokeWidth={2} />
    </span>
  )
}

/**
 * The wallet's face in the header: its published avatar, or the Secret mark
 * when it has none.
 *
 * The mark rather than the generated identicon the profile page falls back to.
 * This chip is the app's own furniture and there is exactly one of it, so a
 * coloured blob would read as a broken image rather than as an identity — the
 * identicon earns its place in a list, where it tells rows apart.
 */
function ChipAvatar({ url }: { url?: string }) {
  if (!url) return <img src="/img/secret-mark.svg" alt="" className="h-[22px] w-[22px] shrink-0" />

  return <img src={url} alt="" className="h-[22px] w-[22px] shrink-0 rounded-pill object-cover" />
}

/**
 * A linked account's own picture, falling back to the generated one.
 *
 * Its own component because the lookups are hooks and the switcher renders one
 * row per account. The Keybase result is cached, so a validator's row and the
 * chip beside it fetch once between them.
 */
function AccountAvatar({ account, size }: { account: LinkedValidator; size: number }) {
  const identity = useStoredIdentity(account)
  const profile = useValidatorProfile(identity)

  return (
    <ValidatorAvatar address={account.valoper} moniker={account.moniker} image={profile?.image} size={size} />
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
function useStoredIdentity(account: LinkedValidator): string | undefined {
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

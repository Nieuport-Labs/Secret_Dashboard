import { ChevronDown, LogOut, Settings as SettingsIcon } from 'lucide-react'

import Menu, { MenuItem } from '@/components/ui/Menu'
import { shortenAddress } from '@/lib/format'
import { useWallet } from '@/store/wallet'

interface Props {
  onOpenSettings: () => void
}

/** The connected address and its menu (Figma 34:668). */
export default function WalletChip({ onOpenSettings }: Props) {
  const address = useWallet((state) => state.address)
  const accountName = useWallet((state) => state.accountName)
  const disconnect = useWallet((state) => state.disconnect)

  if (!address) return null

  return (
    <Menu
      label="Wallet menu"
      triggerClassName="flex items-center gap-2 rounded-pill border border-border px-2.5 py-1.5 text-base font-medium"
      trigger={
        <>
          <img src="/img/secret-mark.svg" alt="" className="h-4 w-4 shrink-0" />
          <span className="whitespace-nowrap">{shortenAddress(address)}</span>
          <ChevronDown size={14} aria-hidden className="text-text-muted" />
        </>
      }
      className="min-w-[210px]"
    >
      {accountName ? <p className="px-3 pb-1 pt-1.5 text-label text-text-faint">{accountName}</p> : null}
      <MenuItem icon={<SettingsIcon size={16} aria-hidden />} onClick={onOpenSettings}>
        Settings
      </MenuItem>
      <MenuItem icon={<LogOut size={16} aria-hidden />} onClick={disconnect}>
        Disconnect
      </MenuItem>
    </Menu>
  )
}

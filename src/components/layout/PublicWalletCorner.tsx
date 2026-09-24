import { Wallet } from 'lucide-react'
import { useState } from 'react'

import WalletChip from '@/components/layout/WalletChip'
import SettingsModal from '@/components/settings/SettingsModal'
import Button from '@/components/ui/Button'
import ConnectWalletModal from '@/components/wallet/ConnectWalletModal'
import { useConnectDialog } from '@/store/connectDialog'
import { useWallet } from '@/store/wallet'

/**
 * The wallet, top right, on the pages that live outside the app shell — a
 * profile and an invoice.
 *
 * Those pages leave the shell's rail and header out on purpose, but not the
 * account: someone paying from them needs to see which wallet will pay, and to
 * switch or connect one without leaving. So this is the header's own chip, or
 * its own connect button, and nothing else from it.
 *
 * The shell mounts the connect dialog once for every page inside it; these
 * pages are not inside it, so this mounts its own.
 */
export default function PublicWalletCorner() {
  const connected = useWallet((state) => state.status === 'connected')
  const connecting = useWallet((state) => state.status === 'connecting')
  const openConnect = useConnectDialog((state) => state.show)
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <div className="flex justify-end">
      {connected ? (
        <WalletChip onOpenSettings={() => setSettingsOpen(true)} />
      ) : (
        <Button
          variant="primary"
          shape="control"
          size="sm"
          loading={connecting}
          onClick={openConnect}
          icon={<Wallet size={14} aria-hidden />}
        >
          Connect wallet
        </Button>
      )}

      <ConnectWalletModal />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}

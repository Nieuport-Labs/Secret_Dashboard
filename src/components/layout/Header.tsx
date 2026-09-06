import { Globe } from 'lucide-react'
import { useState } from 'react'

import GasCreditsChip from '@/components/gas/GasCreditsChip'
import SettingsDrawer from '@/components/settings/SettingsDrawer'
import WalletChip from '@/components/layout/WalletChip'
import { useWallet } from '@/store/wallet'

/**
 * The page's top-right strip (Figma 34:660): gas credits and the connected
 * address once there is one, the language picker either way.
 */
export default function Header() {
  const connected = useWallet((state) => state.status === 'connected')
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 px-5 pt-6 lg:px-12">
      {connected ? (
        <>
          <GasCreditsChip />
          <WalletChip onOpenSettings={() => setSettingsOpen(true)} />
        </>
      ) : (
        <button
          type="button"
          className="state-layer flex items-center gap-1.5 rounded-control px-2 py-1 text-base text-text"
        >
          <Globe size={16} aria-hidden />
          English
        </button>
      )}

      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}

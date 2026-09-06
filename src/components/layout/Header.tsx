import { Globe } from 'lucide-react'
import { useState } from 'react'

import GasCreditsChip from '@/components/gas/GasCreditsChip'
import SettingsDrawer from '@/components/settings/SettingsDrawer'
import WalletChip from '@/components/layout/WalletChip'
import { useWallet } from '@/store/wallet'

/**
 * The page's top-right strip (Figma 34:660): gas credits and the connected
 * address once there is one, the language picker either way.
 *
 * Sticky and glass. A header that scrolls away takes the gas balance and the
 * account with it, and those are exactly the two facts you want on screen while
 * you are deciding to sign something.
 */
export default function Header() {
  const connected = useWallet((state) => state.status === 'connected')
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <div className="glass sticky top-0 z-20 flex flex-wrap items-center justify-end gap-x-2 gap-y-2 border-b border-border px-4 py-2.5 lg:px-8">
      {connected ? (
        <>
          <GasCreditsChip />
          <WalletChip onOpenSettings={() => setSettingsOpen(true)} />
        </>
      ) : (
        <button
          type="button"
          className="state-layer flex items-center gap-1.5 rounded-pill border border-border px-2.5 py-1.5 text-base text-text-muted"
        >
          <Globe size={14} aria-hidden />
          English
        </button>
      )}

      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}

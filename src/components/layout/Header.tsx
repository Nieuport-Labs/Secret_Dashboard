import { Globe, Wallet } from 'lucide-react'
import { useState } from 'react'

import ArrivalsChip from '@/components/wallet/ArrivalsChip'
import Button from '@/components/ui/Button'
import GasCreditsChip from '@/components/gas/GasCreditsChip'
import PrivacyToggle from '@/components/layout/PrivacyToggle'
import SettingsDrawer from '@/components/settings/SettingsDrawer'
import WalletChip from '@/components/layout/WalletChip'
import { useConnectDialog } from '@/store/connectDialog'
import { useWallet } from '@/store/wallet'

/**
 * The page's top-right strip (Figma 34:660): gas credits and the connected
 * account once there is one, the way to connect one before that, and the
 * language picker either way.
 *
 * Sticky and glass. A header that scrolls away takes the gas balance and the
 * account with it, and those are exactly the two facts you want on screen while
 * you are deciding to sign something.
 *
 * `glass` rather than the fill-less `glass-chrome` the rail wears. The rail has
 * nothing passing behind it — the content column is inset by its width on both
 * sides — so blur alone is enough there. This strip does have the page running
 * underneath it, and blur with no base turns a heading scrolling past into a
 * pale smear rather than into depth. The base is near the page colour at 80%,
 * so the strip still reads as the page seen through material and leaves no
 * seam where it meets the rail.
 *
 * The negative margin cancels the shell's right-hand gutter, whatever it
 * currently is, so the strip reaches the screen edge — chips parked short of
 * the corner read as a mistake. It has to be the same clamp the gutter is, not
 * a flat 256px, or on a window narrow enough for the gutter to have shrunk the
 * strip would hang off the side of the screen.
 */
export default function Header() {
  const connected = useWallet((state) => state.status === 'connected')
  const connecting = useWallet((state) => state.status === 'connecting')
  const openConnect = useConnectDialog((state) => state.show)
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <div className="glass sticky top-0 z-20 flex flex-wrap items-center justify-end gap-x-2 gap-y-2 mr-[calc(var(--frame-gutter)*-1)] px-4 py-3 lg:px-8">
      {connected ? (
        <>
          {/* Arrivals first: it is the one that changes on its own, and a
              status that moves is easier to notice at the quiet end of a row
              than wedged between two things that do not. */}
          <ArrivalsChip />
          <GasCreditsChip />
          {/* Beside the figures it hides, so the thing you want gone and the
              switch that removes it are in the same glance. */}
          <PrivacyToggle />
          <WalletChip onOpenSettings={() => setSettingsOpen(true)} />
        </>
      ) : (
        <>
          <button
            type="button"
            className="state-layer flex items-center gap-1.5 rounded-control border border-border px-2.5 py-1.5 text-base text-text-muted"
          >
            <Globe size={14} aria-hidden />
            English
          </button>
          {/*
            The corner an unconnected visitor looks in. It used to be empty, and
            the only way in was the wallet screen — so someone reading the
            network stats or the app list had to work out that "Wallet" in the
            rail was where you go to sign in.
          */}
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
        </>
      )}

      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}

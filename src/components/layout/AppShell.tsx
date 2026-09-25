import type { ReactNode } from 'react'

import Toaster from '@/components/notifications/Toaster'
import FirstRunQuestions from '@/components/onboarding/FirstRunQuestions'
import ConnectWalletModal from '@/components/wallet/ConnectWalletModal'
import WalletDataProvider from '@/components/wallet/WalletDataProvider'
import TransportChip from '@/pages/multisig/components/TransportChip'
import { useActingMode } from '@/store/accounts'
import Header from './Header'
import Sidebar from './Sidebar'

/**
 * Rail, content, footer — the frame every page sits in.
 *
 * Page content is a centred column rather than something that fills the width,
 * which is what keeps a wallet with four balances from looking like a
 * spreadsheet on a 1920px display.
 *
 * It is centred on the *screen*, not in the space left over beside the rail.
 * Reserving the rail's width on both sides costs nothing at these column
 * widths and buys two things: the column sits where the eye looks for it
 * instead of pushed right by the rail, and it lines up with the dialogs, which
 * are fixed to the viewport and were landing a hundred pixels to its left.
 */
export default function AppShell({ children }: { children: ReactNode }) {
  const mode = useActingMode()

  return (
    <WalletDataProvider>
      <div className="min-h-dvh">
        <Sidebar />

        {/* The gutters, and the padding that clears the mobile bottom bar.
            In CSS rather than in utilities because the right-hand one is a
            clamp against the content floor and not a width a breakpoint can
            name — see `.app-frame` in index.css. */}
        <div className="app-frame flex min-h-dvh flex-col">
          {/* The strip reaches the screen edge; only the content column is inset.
            Chips parked 256px short of the corner read as a mistake. The pull
            is on the header itself rather than on a wrapper: a wrapper is only
            as tall as the header, and a sticky element cannot travel outside
            its own parent, so one would pin the strip to nothing and let it
            scroll away. */}
          <Header />

          <main id="content" className="flex-1 px-4 pb-10 pt-7 lg:px-8 lg:pb-14">
            {children}
          </main>

          {/* Chrome, so it is sized like chrome. The attribution has to be there;
            it does not have to be the loudest thing above the fold.

            The group's channel status keeps it company while a multisig is
            open. It belongs with the chrome for the same reason: it is true of
            the whole app rather than of anything on the page, and what it
            reports is almost always "still up". */}
          <footer className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-5 py-6 text-text-faint">
            <span className="flex items-center gap-2">
              <span className="text-label">Powered by Secret Network</span>
              <img src="/img/secret-mark.svg" alt="" className="h-4 w-[15px] opacity-70" />
            </span>
            {mode === 'multisig' ? <TransportChip /> : null}
          </footer>
        </div>

        {/* One picker for the whole app, opened from the header and from every
            empty state that needs an account. */}
        <ConnectWalletModal />
        {/* The first-run questions, once per account. */}
        <FirstRunQuestions />
        <Toaster />
      </div>
    </WalletDataProvider>
  )
}

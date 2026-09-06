import type { ReactNode } from 'react'

import Toaster from '@/components/notifications/Toaster'
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
  return (
    <div className="min-h-dvh">
      <Sidebar />

      {/* pb clears the mobile bottom bar; from lg the rail takes the left edge. */}
      <div className="flex min-h-dvh flex-col pb-16 lg:pb-0 lg:pl-[var(--sidebar-width)] lg:pr-[var(--sidebar-width)]">
        {/* The strip reaches the screen edge; only the content column is inset.
            Chips parked 256px short of the corner read as a mistake. */}
        <div className="lg:-mr-[var(--sidebar-width)]">
          <Header />
        </div>

        <main id="content" className="flex-1 px-4 pb-10 pt-7 lg:px-8 lg:pb-14">
          {children}
        </main>

        {/* Chrome, so it is sized like chrome. The attribution has to be there;
            it does not have to be the loudest thing above the fold. */}
        <footer className="flex items-center justify-center gap-2 px-5 py-6 text-text-faint">
          <span className="text-label">Powered by Secret Network</span>
          <img src="/img/secret-mark.svg" alt="" className="h-4 w-[15px] opacity-70" />
        </footer>
      </div>

      <Toaster />
    </div>
  )
}

import type { ReactNode } from 'react'

import Toaster from '@/components/notifications/Toaster'
import Header from './Header'
import Sidebar from './Sidebar'

/**
 * Rail, content, footer — the frame every page sits in.
 *
 * The design centres page content in the space beside the rail rather than
 * filling it, which is what keeps a wallet with four balances from looking like
 * a spreadsheet on a 1920px display.
 */
export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh">
      <Sidebar />

      {/* pb clears the mobile bottom bar; from lg the rail takes the left edge. */}
      <div className="flex min-h-dvh flex-col pb-16 lg:pb-0 lg:pl-[var(--sidebar-width)]">
        <Header />

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

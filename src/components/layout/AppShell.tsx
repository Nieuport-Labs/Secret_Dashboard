import type { ReactNode } from 'react'

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
      <div className="flex min-h-dvh flex-col pb-20 lg:pb-0 lg:pl-[var(--sidebar-width)]">
        <Header />

        <main id="content" className="flex-1 px-5 pb-8 pt-4 lg:px-12 lg:pb-12">
          {children}
        </main>

        <footer className="flex items-center justify-center gap-2.5 px-5 py-6 opacity-60">
          <span className="text-base font-semibold">Powered by Secret Network</span>
          <img src="/img/secret-mark.svg" alt="" className="h-7 w-[27px]" />
        </footer>
      </div>
    </div>
  )
}

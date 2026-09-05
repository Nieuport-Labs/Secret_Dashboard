import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import AppShell from '@/components/layout/AppShell'
import { onAccountChange } from '@/lib/wallet'
import Placeholder from '@/pages/Placeholder'
import Wallet from '@/pages/wallet/Wallet'
import Welcome from '@/pages/welcome/Welcome'
import { applyTheme, useSettings } from '@/store/settings'
import { handleAccountChange, lastUsedWallet, useWallet } from '@/store/wallet'

export default function App() {
  const theme = useSettings((state) => state.theme)
  const status = useWallet((state) => state.status)
  const connectWallet = useWallet((state) => state.connectWallet)
  const initQueryClient = useWallet((state) => state.initQueryClient)

  useEffect(() => applyTheme(theme), [theme])

  // A read-only client, so prices, validators and chain stats work before
  // anyone connects. Endpoint probing means this can fail; the pages that need
  // it report that themselves rather than blocking the shell.
  useEffect(() => {
    void initQueryClient()
  }, [initQueryClient])

  // Reconnect silently to the wallet last used. The extension still asks for
  // approval the first time per session, so this cannot connect behind the
  // user's back.
  useEffect(() => {
    const previous = lastUsedWallet()
    if (previous) void connectWallet(previous)
  }, [connectWallet])

  // Switching account or network in the wallet invalidates every address-keyed
  // thing on screen at once.
  useEffect(() => onAccountChange(handleAccountChange), [])

  const connected = status === 'connected'

  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/wallet" replace />} />
        <Route path="/wallet" element={connected ? <Wallet /> : <Welcome />} />
        <Route
          path="/bridge"
          element={
            <Placeholder
              title="Bridge"
              phase="phase 6"
              summary="IBC transfer with auto-wrap on arrival, and Get gas — swapping a slice of what you bridge into gas credits in flight, so an empty Secret wallet can still transact."
            />
          }
        />
        <Route
          path="/staking"
          element={
            <Placeholder
              title="Staking"
              phase="phase 7"
              summary="Delegate, redelegate, claim, and auto-restake through MsgSetAutoRestake — which the chain only honours above 10 SCRT per validator."
            />
          }
        />
        <Route
          path="/ecosystem"
          element={
            <Placeholder
              title="Ecosystem"
              phase="phase 8"
              summary="Secret dApps from the DappRegistry, and where to buy SCRT."
            />
          }
        />
        <Route
          path="/network"
          element={
            <Placeholder
              title="Network"
              phase="phase 8"
              summary="Price, TVL, chain statistics and node health."
            />
          }
        />
        <Route
          path="/powertools"
          element={
            <Placeholder
              title="Powertools"
              phase="phase 8"
              summary="Compose and broadcast raw messages, and check endpoint health."
            />
          }
        />
        <Route
          path="/onboarding"
          element={
            <Placeholder
              title="Onboarding"
              phase="phase 8"
              summary="Choosing a wallet, what SCRT is, what SNIP-20 tokens are, what Secret dApps are, and how to bridge in."
            />
          }
        />
        <Route path="*" element={<Navigate to="/wallet" replace />} />
      </Routes>
    </AppShell>
  )
}

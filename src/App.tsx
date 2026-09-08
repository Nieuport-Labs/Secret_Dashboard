import { lazy, Suspense, useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import AppShell from '@/components/layout/AppShell'
import { onAccountChange } from '@/lib/wallet'
import Wallet from '@/pages/wallet/Wallet'
import Welcome from '@/pages/welcome/Welcome'
import { applyTheme, useSettings } from '@/store/settings'
import { handleAccountChange, lastUsedWallet, useWallet } from '@/store/wallet'

/**
 * The bridge carries the route tables — every token on every chain, and their
 * denominations at each end — plus cosmjs for signing on other chains. None of
 * that belongs in the first load of a wallet screen, so it arrives when someone
 * actually goes to bridge.
 */
const Bridge = lazy(() => import('@/pages/bridge/Bridge'))
const Staking = lazy(() => import('@/pages/staking/Staking'))
const Governance = lazy(() => import('@/pages/governance/Governance'))
const ProposalDetail = lazy(() => import('@/pages/governance/ProposalDetail'))
const Ecosystem = lazy(() => import('@/pages/ecosystem/Ecosystem'))
const Network = lazy(() => import('@/pages/network/Network'))
const Powertools = lazy(() => import('@/pages/powertools/Powertools'))
const Onboarding = lazy(() => import('@/pages/onboarding/Onboarding'))

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
            <Suspense fallback={<p className="text-base text-text-muted">Loading the bridge…</p>}>
              <Bridge />
            </Suspense>
          }
        />
        <Route
          path="/staking"
          element={
            <Suspense fallback={<p className="text-base text-text-muted">Loading staking…</p>}>
              <Staking />
            </Suspense>
          }
        />
        <Route
          path="/governance"
          element={
            <Suspense fallback={<p className="text-base text-text-muted">Loading governance…</p>}>
              <Governance />
            </Suspense>
          }
        />
        {/* Each proposal has its own address, so one can be linked, shared and
            opened in a tab of its own. */}
        <Route
          path="/governance/:id"
          element={
            <Suspense fallback={<p className="text-base text-text-muted">Loading proposal…</p>}>
              <ProposalDetail />
            </Suspense>
          }
        />
        <Route
          path="/ecosystem"
          element={
            <Suspense fallback={<p className="text-base text-text-muted">Loading…</p>}>
              <Ecosystem />
            </Suspense>
          }
        />
        <Route
          path="/network"
          element={
            <Suspense fallback={<p className="text-base text-text-muted">Loading…</p>}>
              <Network />
            </Suspense>
          }
        />
        <Route
          path="/powertools"
          element={
            <Suspense fallback={<p className="text-base text-text-muted">Loading…</p>}>
              <Powertools />
            </Suspense>
          }
        />
        <Route
          path="/onboarding"
          element={
            <Suspense fallback={<p className="text-base text-text-muted">Loading…</p>}>
              <Onboarding />
            </Suspense>
          }
        />
        <Route path="*" element={<Navigate to="/wallet" replace />} />
      </Routes>
    </AppShell>
  )
}

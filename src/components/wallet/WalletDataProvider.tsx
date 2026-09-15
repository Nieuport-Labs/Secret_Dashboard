import { useCallback, useMemo, type ReactNode } from 'react'

import { useActivity } from '@/hooks/useActivity'
import { useArrivals } from '@/hooks/useArrivals'
import { useBalances } from '@/hooks/useBalances'
import { useDerivative } from '@/hooks/useDerivative'
import { useNativeUnbondings } from '@/hooks/useNativeUnbondings'
import { STAKING_SCOPE, usePermit } from '@/hooks/usePermit'
import { WalletDataContext, type WalletData } from '@/hooks/walletData'

/**
 * Reads the account once, for the whole shell.
 *
 * Sits above the router so the reads survive navigation and so the header can
 * show what they are doing from any screen. See `walletData.ts` for why this
 * moved out of the wallet page.
 */
export default function WalletDataProvider({ children }: { children: ReactNode }) {
  const { permit, staleTokens, signing, error, sign } = usePermit()
  // A second permit, for Shade's derivative alone. Its contract does not speak
  // the standard permission vocabulary, so one signature cannot serve both.
  const staking = usePermit(STAKING_SCOPE)
  const balances = useBalances(permit)
  const activity = useActivity(permit)
  const derivative = useDerivative(staking.permit)
  const nativeUnbondings = useNativeUnbondings()

  // Anything that moves money moves both lists. They are read separately and
  // would otherwise disagree until one of them next polled.
  const activityRefresh = activity.refresh
  const balancesRefresh = balances.refresh
  // The derivative's queue moves with them: unbonding is a transfer out of the
  // balance and into the queue, and claiming is the same trip back.
  const derivativeRefresh = derivative.refresh
  const unbondingsRefresh = nativeUnbondings.refresh
  const refreshAll = useCallback(() => {
    balancesRefresh()
    activityRefresh()
    derivativeRefresh()
    unbondingsRefresh()
  }, [balancesRefresh, activityRefresh, derivativeRefresh, unbondingsRefresh])

  const push = useArrivals(permit, { onArrival: refreshAll })

  const signPermit = useCallback(() => void sign(), [sign])
  const stakingSign = staking.sign
  const signStakingPermit = useCallback(() => void stakingSign(), [stakingSign])

  const value = useMemo<WalletData>(
    () => ({
      permit,
      staleTokens,
      signing,
      permitError: error,
      sign: signPermit,
      stakingPermit: {
        signed: Boolean(staking.permit),
        signing: staking.signing,
        error: staking.error,
        sign: signStakingPermit
      },
      balances,
      activity: {
        entries: activity.entries,
        loading: activity.loading,
        unreadable: activity.unreadable,
        publicError: activity.publicError,
        refresh: activityRefresh
      },
      derivative,
      nativeUnbondings,
      pushStatus: push.status,
      refreshAll
    }),
    [
      permit,
      staleTokens,
      signing,
      error,
      signPermit,
      staking.permit,
      staking.signing,
      staking.error,
      signStakingPermit,
      balances,
      activity.entries,
      activity.loading,
      activity.unreadable,
      activity.publicError,
      activityRefresh,
      derivative,
      nativeUnbondings,
      push.status,
      refreshAll
    ]
  )

  return <WalletDataContext.Provider value={value}>{children}</WalletDataContext.Provider>
}

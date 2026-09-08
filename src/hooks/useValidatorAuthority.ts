import { useCallback, useEffect, useState } from 'react'

import { queryValidatorGrants, type Grant } from '@/lib/authz'
import { toOperatorAddress } from '@/lib/validator'
import { useActiveValidator } from '@/store/accounts'
import { useWallet } from '@/store/wallet'

export interface ValidatorAuthority {
  /** The account the chain demands as signer. Absent outside validator mode. */
  operator?: string
  /** The connected wallet *is* that account, so nothing needs granting. */
  direct: boolean
  /** Live grants from the operator to this wallet, keyed by message type. */
  grants: Map<string, Grant>
  loading: boolean
  refresh: () => void
  /** Whether this wallet may send that message for the validator at all. */
  allows: (msgType: string) => boolean
  /** Sending it requires wrapping in `MsgExec` rather than signing it plainly. */
  viaGrant: (msgType: string) => boolean
}

/**
 * What the connected wallet is allowed to do for the active validator.
 *
 * Two routes lead to the same place. The operator key signs validator messages
 * directly, because the chain derives their signer from the validator address
 * and finds that key. Anyone else signs a `MsgExec` wrapper, and the chain
 * checks a grant instead. Every caller wants the same answer — may I, and by
 * which route — so it is worked out once here rather than at each button.
 *
 * Outside validator mode this answers "no" to everything, which is correct: the
 * ordinary wallet screens act for the wallet itself and never ask.
 */
export function useValidatorAuthority(): ValidatorAuthority {
  const active = useActiveValidator()
  const valoper = active?.account.valoper
  const address = useWallet((state) => state.address)
  const client = useWallet((state) => state.queryClient)

  const operator = valoper ? toOperatorAddress(valoper) : undefined
  const direct = Boolean(operator && operator === address)

  const [grants, setGrants] = useState<Map<string, Grant>>(new Map())
  const [loading, setLoading] = useState(false)
  const [nonce, setNonce] = useState(0)

  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    // The operator needs no grant from itself, and asking would always answer
    // no — authz refuses a self-grant — which would read as a missing
    // permission on a screen that has every permission.
    if (!client || !operator || !address || direct) {
      setGrants(new Map())
      return
    }

    let cancelled = false
    setLoading(true)

    void queryValidatorGrants(client, operator, address)
      .then((found) => {
        if (cancelled) return
        setGrants(new Map(found.map((grant) => [grant.msgType, grant])))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [client, operator, address, direct, nonce])

  return {
    operator,
    direct,
    grants,
    loading,
    refresh,
    allows: (msgType) => direct || grants.has(msgType),
    viaGrant: (msgType) => !direct && grants.has(msgType)
  }
}

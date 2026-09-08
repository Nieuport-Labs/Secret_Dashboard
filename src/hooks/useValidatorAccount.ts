import { useCallback, useEffect, useState } from 'react'

import { errorMessage } from '@/lib/errors'
import { queryBondedTokens } from '@/lib/governance'
import {
  queryDelegatorCount,
  queryOutstandingCommission,
  querySelfDelegation,
  querySigningRecord,
  queryValidatorDetail,
  type SigningRecord,
  type ValidatorDetail
} from '@/lib/validator'
import { useWallet } from '@/store/wallet'

export interface ValidatorAccountData {
  detail?: ValidatorDetail
  signing?: SigningRecord
  /** Base units. */
  selfDelegation: string
  outstandingCommission: string
  delegators?: number
  /** Everything bonded chain-wide, for sizing this validator against it. */
  totalBonded: bigint
  loading: boolean
  error?: string
  refresh: () => void
}

/**
 * Everything both validator screens read, in one pass.
 *
 * Runs on the read-only client, so a validator can be inspected before — or
 * without — connecting the wallet that operates it. Only the staking record is
 * allowed to fail the whole thing: without it there is no validator to show a
 * page about, whereas a missing commission figure or delegator count is one
 * blank tile on a page that is otherwise correct.
 */
export function useValidatorAccount(valoper: string | undefined): ValidatorAccountData {
  const client = useWallet((state) => state.queryClient)

  const [detail, setDetail] = useState<ValidatorDetail | undefined>()
  const [signing, setSigning] = useState<SigningRecord | undefined>()
  const [selfDelegation, setSelfDelegation] = useState('0')
  const [outstandingCommission, setOutstandingCommission] = useState('0')
  const [delegators, setDelegators] = useState<number | undefined>()
  const [totalBonded, setTotalBonded] = useState(0n)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [nonce, setNonce] = useState(0)

  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    if (!client || !valoper) return

    let cancelled = false
    setLoading(true)
    setError(undefined)

    const run = async () => {
      try {
        const record = await queryValidatorDetail(client, valoper)
        if (cancelled) return
        if (!record) {
          setError('No validator on this chain has that address.')
          setLoading(false)
          return
        }
        setDetail(record)

        // The signing record needs the consensus key that only just arrived,
        // so it cannot join the batch above.
        const [signingRecord, self, commission, count, bonded] = await Promise.all([
          querySigningRecord(client, record.consensusKey),
          querySelfDelegation(client, valoper),
          queryOutstandingCommission(client, valoper),
          queryDelegatorCount(client, valoper),
          queryBondedTokens(client).catch(() => 0n)
        ])

        if (cancelled) return
        setSigning(signingRecord)
        setSelfDelegation(self)
        setOutstandingCommission(commission)
        setDelegators(count)
        setTotalBonded(bonded)
        setLoading(false)
      } catch (caught) {
        if (cancelled) return
        setError(errorMessage(caught))
        setLoading(false)
      }
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [client, valoper, nonce])

  return {
    detail,
    signing,
    selfDelegation,
    outstandingCommission,
    delegators,
    totalBonded,
    loading,
    error,
    refresh
  }
}

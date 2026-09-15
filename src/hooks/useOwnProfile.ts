import { useCallback, useEffect, useState } from 'react'

import { DENOM, GAS, GAS_PRICE_USCRT, PROFILE_REGISTRY_ADDRESS } from '@/chains/secret4'
import { codeHashFor } from '@/lib/codeHash'
import { errorMessage } from '@/lib/errors'
import { MSG_EXECUTE_CONTRACT } from '@/lib/msgTypes'
import {
  clearProfileMsg,
  EMPTY_DRAFT,
  queryProfile,
  registryConfigured,
  setProfileMsg,
  type Profile,
  type ProfileDraft
} from '@/lib/profile'
import { forgetProfile } from '@/hooks/useProfileIdentity'
import type { ActionState } from '@/hooks/useWalletActions'
import { useFeePayer } from '@/store/feePayer'
import { useWallet } from '@/store/wallet'

/**
 * The connected account's own profile: what is on chain, what is being edited,
 * and the transaction that closes the gap between them.
 *
 * Kept apart from `useProfileIdentity`, which reads *anyone's* profile and
 * caches it for the page. This one is about editing, which needs the unsaved
 * draft, the dirty flag and the signing client — none of which belong in a
 * lookup that every avatar on a list runs.
 *
 * There is no autosave and no debounce. Every write here is a transaction with
 * a wallet prompt and a fee attached, so it happens when the user presses the
 * button and at no other time.
 */

function toDraft(profile: Profile | undefined): ProfileDraft {
  if (!profile) return EMPTY_DRAFT
  return { name: profile.name, bio: profile.bio, avatar: profile.avatar, links: profile.links }
}

/** Order-insensitive enough for a form whose rows are fixed. */
function same(a: ProfileDraft, b: ProfileDraft): boolean {
  return JSON.stringify(setProfileMsg(a)) === JSON.stringify(setProfileMsg(b))
}

export function useOwnProfile() {
  const client = useWallet((state) => state.client)
  const queryClient = useWallet((state) => state.queryClient)
  const address = useWallet((state) => state.address)
  const granterFor = useFeePayer((state) => state.granterFor)

  const [saved, setSaved] = useState<ProfileDraft>(EMPTY_DRAFT)
  const [draft, setDraft] = useState<ProfileDraft>(EMPTY_DRAFT)
  const [loading, setLoading] = useState(true)
  const [state, setState] = useState<ActionState>({ kind: 'idle' })

  const load = useCallback(async () => {
    if (!queryClient || !address || !registryConfigured()) {
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const next = toDraft(await queryProfile(queryClient, address))
      setSaved(next)
      setDraft(next)
    } catch {
      // A registry that cannot be read leaves the form empty rather than
      // broken. Saving from here would overwrite a profile the user could not
      // see, so the caller disables the button while this is true.
      setSaved(EMPTY_DRAFT)
      setDraft(EMPTY_DRAFT)
    } finally {
      setLoading(false)
    }
  }, [queryClient, address])

  useEffect(() => {
    void load()
  }, [load])

  const broadcast = useCallback(
    async (msg: object, gasLimit: number) => {
      if (!client || !queryClient || !address || !registryConfigured()) return
      setState({ kind: 'sending' })

      try {
        const { MsgExecuteContract } = await import('secretjs')
        const tx = await client.tx.broadcast(
          [
            new MsgExecuteContract({
              sender: address,
              contract_address: PROFILE_REGISTRY_ADDRESS,
              code_hash: await codeHashFor(queryClient, PROFILE_REGISTRY_ADDRESS),
              msg,
              sent_funds: []
            })
          ],
          {
            gasLimit,
            gasPriceInFeeDenom: GAS_PRICE_USCRT,
            feeDenom: DENOM,
            feeGranter: granterFor(gasLimit, [MSG_EXECUTE_CONTRACT])
          }
        )

        if (tx.code !== 0) {
          setState({ kind: 'failed', message: tx.rawLog || `The chain rejected it (code ${tx.code}).` })
          return
        }

        // The cached copy every other screen reads is now wrong; drop it before
        // re-reading, or the profile page shows the old name until a reload.
        forgetProfile(address)
        await load()
        setState({ kind: 'done', hash: tx.transactionHash })
      } catch (error) {
        setState({ kind: 'failed', message: errorMessage(error) })
      }
    },
    [client, queryClient, address, granterFor, load]
  )

  const save = useCallback(() => broadcast(setProfileMsg(draft), GAS.setProfile), [broadcast, draft])

  const clear = useCallback(() => broadcast(clearProfileMsg, GAS.clearProfile), [broadcast])

  /** Put the form back to what is on chain. */
  const revert = useCallback(() => {
    setDraft(saved)
    setState({ kind: 'idle' })
  }, [saved])

  const update = useCallback((patch: Partial<ProfileDraft>) => {
    setDraft((current) => ({ ...current, ...patch }))
    // A previous result stops describing the form the moment it is edited
    // again, and a stale "Saved" beside unsaved changes is a lie.
    setState({ kind: 'idle' })
  }, [])

  return {
    draft,
    update,
    revert,
    save,
    clear,
    loading,
    state,
    dirty: !same(draft, saved),
    /** Whether anything is on chain to clear. */
    published: !same(saved, EMPTY_DRAFT)
  }
}

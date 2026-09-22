import { useCallback, useEffect, useState } from 'react'

import { errorMessage } from '@/lib/errors'
import { EMPTY_DRAFT, registryConfigured, setProfileMsg, type ProfileDraft } from '@/lib/profile'
import type { RecordProfile } from '@/lib/profileRecord'
import { normalise, publishOffchain } from '@/lib/profileServer'
import { profileState, rememberOffchain } from '@/lib/profileSync'
import { writePendingProfile } from '@/lib/sendTx'
import type { ActionState } from '@/hooks/useWalletActions'
import { useWallet } from '@/store/wallet'

/**
 * The connected account's own profile: what is published, what is being
 * edited, and the two ways of closing the gap between them.
 *
 * Saving costs nothing. The wallet signs the profile as a message, not a
 * transaction, and the server keeps the signed copy; everyone sees it at once.
 * The chain catches up by itself — the next transaction this account sends
 * carries the write along (`lib/sendTx.ts`) — or right away, for someone with
 * gas who presses "Write on chain now".
 *
 * Kept apart from `useProfileIdentity`, which reads *anyone's* profile. This
 * one is about editing, which needs the unsaved draft, the dirty flag and the
 * wallet — none of which belong in a lookup that every avatar on a list runs.
 *
 * There is no autosave. Every save is a wallet prompt, so it happens when the
 * user presses the button and at no other time.
 */

/** `stored`: signed and kept by the server; on chain later. */
export type ProfileActionState = ActionState | { kind: 'stored' }

function toDraft(profile: RecordProfile | undefined): ProfileDraft {
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
  const walletId = useWallet((state) => state.walletId)

  const [saved, setSaved] = useState<ProfileDraft>(EMPTY_DRAFT)
  const [draft, setDraft] = useState<ProfileDraft>(EMPTY_DRAFT)
  const [pending, setPending] = useState(false)
  const [loading, setLoading] = useState(true)
  const [state, setState] = useState<ProfileActionState>({ kind: 'idle' })

  const load = useCallback(async () => {
    if (!queryClient || !address) {
      setLoading(false)
      return
    }

    setLoading(true)
    const current = await profileState(queryClient, address)
    const next = toDraft(current.profile)
    setSaved(next)
    setDraft(next)
    setPending(current.pending)
    setLoading(false)
  }, [queryClient, address])

  useEffect(() => {
    void load()
  }, [load])

  const store = useCallback(
    async (profile: RecordProfile | null) => {
      if (!queryClient || !address || !walletId) return
      setState({ kind: 'sending' })
      try {
        const offchain = await publishOffchain(walletId, address, profile)
        await rememberOffchain(queryClient, address, offchain)
        await load()
        setState({ kind: 'stored' })
      } catch (error) {
        setState({ kind: 'failed', message: errorMessage(error) })
      }
    },
    [queryClient, address, walletId, load]
  )

  const save = useCallback(() => store(normalise(draft)), [store, draft])

  const clear = useCallback(() => store(null), [store])

  /** For someone with gas who would rather not wait for their next transaction. */
  const writeNow = useCallback(async () => {
    if (!client) return
    setState({ kind: 'sending' })
    try {
      const tx = await writePendingProfile(client)
      if (!tx) {
        await load()
        setState({ kind: 'idle' })
        return
      }
      if (tx.code !== 0) {
        setState({ kind: 'failed', message: tx.rawLog || `The chain rejected it (code ${tx.code}).` })
        return
      }
      await load()
      setState({ kind: 'done', hash: tx.transactionHash })
    } catch (error) {
      setState({ kind: 'failed', message: errorMessage(error) })
    }
  }, [client, load])

  /** Put the form back to what is published. */
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
    writeNow,
    loading,
    state,
    dirty: !same(draft, saved),
    /** Whether anything is published to clear. */
    published: !same(saved, EMPTY_DRAFT),
    /** Saved, but the chain does not say it yet. */
    pending,
    /** Whether a write on chain is possible at all on this network yet. */
    onchain: registryConfigured()
  }
}

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { addressForPubkey, isMember } from '@/lib/multisig/config'
import { awaitsSignature } from '@/lib/multisig/stage'
import type { BroadcastReceipt, Proposal, SignatureBundle } from '@/lib/multisig/bundle'
import { useActiveMultisigConfig } from '@/store/multisig'
import { useWallet } from '@/store/wallet'

/**
 * Proposals in flight, and the signatures collected for them.
 *
 * Local, and deliberately so. There is no server in this design: a proposal is
 * a document that travels between members by whatever route they have, and
 * each of them keeps their own copy. Two members' copies can differ — one has
 * three signatures, another has two — and that is not a conflict to resolve
 * but the normal state of a round in progress. Whoever ends up with a
 * threshold broadcasts.
 *
 * Nothing here is trusted because it is stored. A proposal read back out of
 * this store is checked exactly as it was when it arrived, because the thing
 * that makes a proposal safe to sign is the check, not where it was kept.
 */

export interface ProposalEntry {
  proposal: Proposal
  /** Verified before they are added — see `addSignature`. */
  signatures: SignatureBundle[]
  receipt?: BroadcastReceipt
  /** When this copy last changed, for sorting and for pruning. */
  updatedAt: number
}

interface ProposalState {
  /** By multisig address, then by proposal id. */
  byAccount: Record<string, Record<string, ProposalEntry>>

  upsert: (proposal: Proposal) => void
  addSignature: (proposalId: string, multisig: string, bundle: SignatureBundle) => void
  recordBroadcast: (receipt: BroadcastReceipt) => void
  discard: (multisig: string, proposalId: string) => void
  /** Drop broadcast and long-dead proposals, so the store does not grow forever. */
  prune: (olderThanMs?: number) => void
}

/** A month is long enough to find a proposal again, short enough not to hoard. */
const DEFAULT_PRUNE_AGE = 30 * 24 * 60 * 60 * 1000

export const useMultisigProposals = create<ProposalState>()(
  persist(
    (set, get) => ({
      byAccount: {},

      upsert: (proposal) => {
        const forAccount = get().byAccount[proposal.multisig] ?? {}
        const existing = forAccount[proposal.id]

        set({
          byAccount: {
            ...get().byAccount,
            [proposal.multisig]: {
              ...forAccount,
              // Signatures already collected survive a second copy of the same
              // proposal arriving — the usual case being a member importing the
              // bundle they were sent after signing it themselves.
              [proposal.id]: {
                proposal,
                signatures: existing?.signatures ?? [],
                receipt: existing?.receipt,
                updatedAt: Date.now()
              }
            }
          }
        })
      },

      addSignature: (proposalId, multisig, bundle) => {
        const forAccount = get().byAccount[multisig]
        const entry = forAccount?.[proposalId]
        if (!entry) return

        // One signature per member. A member who signs twice — two devices, or
        // re-importing their own bundle — has still signed once, and counting
        // it twice would make a 2-of-3 look satisfied by one person.
        const signer = addressForPubkey(bundle.pubkey)
        const rest = entry.signatures.filter((existing) => addressForPubkey(existing.pubkey) !== signer)

        set({
          byAccount: {
            ...get().byAccount,
            [multisig]: {
              ...forAccount,
              [proposalId]: { ...entry, signatures: [...rest, bundle], updatedAt: Date.now() }
            }
          }
        })
      },

      /**
       * A receipt names the member set it belongs to rather than the account
       * address, so the proposal it refers to is found by looking for its id.
       * A receipt for a proposal this copy has never seen is dropped: there is
       * nothing to attach it to, and inventing a placeholder would put a
       * transaction on screen that nobody here could check.
       */
      recordBroadcast: (receipt) => {
        const byAccount = get().byAccount
        const multisig = Object.keys(byAccount).find((address) => byAccount[address][receipt.proposalId])
        if (!multisig) return

        const proposals = byAccount[multisig]
        set({
          byAccount: {
            ...byAccount,
            [multisig]: {
              ...proposals,
              [receipt.proposalId]: { ...proposals[receipt.proposalId], receipt, updatedAt: Date.now() }
            }
          }
        })
      },

      discard: (multisig, proposalId) => {
        const forAccount = get().byAccount[multisig]
        if (!forAccount) return

        const rest = Object.fromEntries(Object.entries(forAccount).filter(([id]) => id !== proposalId))
        set({ byAccount: { ...get().byAccount, [multisig]: rest } })
      },

      prune: (olderThanMs = DEFAULT_PRUNE_AGE) => {
        const cutoff = Date.now() - olderThanMs
        const byAccount: ProposalState['byAccount'] = {}

        for (const [multisig, proposals] of Object.entries(get().byAccount)) {
          const kept = Object.entries(proposals).filter(
            ([, entry]) => entry.updatedAt >= cutoff && !entry.receipt
          )
          if (kept.length > 0) byAccount[multisig] = Object.fromEntries(kept)
        }

        set({ byAccount })
      }
    }),
    {
      name: 'secret-dashboard:multisig:proposals',
      version: 1,
      partialize: (state) => ({ byAccount: state.byAccount })
    }
  )
)

/** Newest first, which is the order a round is worked through. */
export function useProposalsFor(multisig: string | undefined): ProposalEntry[] {
  const byAccount = useMultisigProposals((state) => state.byAccount)
  if (!multisig) return []
  return Object.values(byAccount[multisig] ?? {}).sort((a, b) => b.proposal.createdAt - a.proposal.createdAt)
}

export function useProposalEntry(
  multisig: string | undefined,
  id: string | undefined
): ProposalEntry | undefined {
  const byAccount = useMultisigProposals((state) => state.byAccount)
  if (!multisig || !id) return undefined
  return byAccount[multisig]?.[id]
}

/**
 * How many open proposals this wallet has not signed — the number behind the
 * dot on the Proposals tab.
 *
 * Counted for the account the shell is currently wearing and for the wallet
 * currently connected, because both are what make a proposal "yours to sign":
 * a member who switches keys is no longer being waited on, and nor is anyone
 * looking at somebody else's multisig. Zero when either is missing, which is
 * also what stops the rail advertising work to a visitor who cannot do it.
 */
export function useAwaitingMySignature(): number {
  const byAccount = useMultisigProposals((state) => state.byAccount)
  const config = useActiveMultisigConfig()
  const address = useWallet((state) => state.address)

  if (!config || !address || !isMember(config, address)) return 0
  return Object.values(byAccount[config.address] ?? {}).filter((entry) => awaitsSignature(entry, address))
    .length
}

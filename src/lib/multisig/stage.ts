/**
 * Where a proposal has got to, as one word.
 *
 * In `lib` rather than beside the card that draws it, because the rail needs
 * these too: the badge on the Proposals tab is the same question as the chip
 * on the card, and two answers to it would eventually disagree. The list, the
 * card, the detail screen and the navigation all read "ready" and "waiting for
 * you" from here rather than each working it out from `signatures.length`.
 *
 * The count here is of signatures *collected*, not of signatures verified. The
 * two differ only when something has gone wrong, and the difference is not
 * this module's to hide: verification needs the rebuilt document, which exists
 * on the proposal's own screen and nowhere else. So a card says how many
 * arrived, and the screen that can prove them says how many count.
 */

import { addressForPubkey } from '@/lib/multisig/config'
import type { ProposalEntry } from '@/store/multisigProposals'

export type ProposalStage = 'collecting' | 'ready' | 'broadcast' | 'refused'

export const STAGE_LABELS: Record<ProposalStage, string> = {
  collecting: 'Collecting signatures',
  ready: 'Ready to broadcast',
  broadcast: 'Broadcast',
  refused: 'Refused by the chain'
}

export function stageOf(entry: ProposalEntry, threshold: number): ProposalStage {
  if (entry.receipt) return entry.receipt.code === 0 ? 'broadcast' : 'refused'
  return entry.signatures.length >= threshold ? 'ready' : 'collecting'
}

/**
 * Whether this wallet is already among the signatures.
 *
 * By address rather than by key, like everywhere else — an address is a hash
 * of a key, and the address is the part a wallet hands over without being
 * asked. A bundle whose key will not decode is somebody else's problem to
 * report; here it is simply not this wallet's signature.
 */
export function hasSigned(entry: ProposalEntry, address: string | undefined): boolean {
  if (!address) return false

  return entry.signatures.some((bundle) => {
    try {
      return addressForPubkey(bundle.pubkey) === address
    } catch {
      return false
    }
  })
}

/** Still waiting for this wallet, and this wallet can do something about it. */
export function awaitsSignature(entry: ProposalEntry, address: string | undefined): boolean {
  return !entry.receipt && !hasSigned(entry, address)
}

/**
 * "3 hours ago" — how a proposal in flight is actually referred to.
 *
 * A date and time is the wrong unit for something that lives for an afternoon,
 * and the round is the subject: what matters is whether this has been sitting
 * there since yesterday, not that it was composed at 14:05.
 */
export function ageLabel(at: number): string {
  const elapsed = Date.now() - at
  if (elapsed < 60_000) return 'just now'

  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 60) return `${minutes} min ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`

  const days = Math.floor(hours / 24)
  return `${days} ${days === 1 ? 'day' : 'days'} ago`
}

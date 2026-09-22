import { CHAIN_ID } from '@/chains/secret4'
import type { ProfileDraft } from '@/lib/profile'
import { setProfileMsg } from '@/lib/profile'
import {
  parseRecordBody,
  profileProblem,
  type OffchainProfile,
  type ProfileRecordBody,
  type RecordProfile,
  type SignedProfileRecord
} from '@/lib/profileRecord'
import { getProvider, type WalletId } from '@/lib/wallet'

/**
 * The client half of `api/profile.ts`: sign a profile for free, keep it on the
 * server, read it back.
 *
 * A read never trusts the server's word for whose profile it is — the record
 * carries its own signature, and the server already refused any that did not
 * verify. What a reader does check is that the record is about the address it
 * asked for, so a misbehaving store cannot hand one account's face to another.
 */

const ENDPOINT = '/api/profile'

/** The draft exactly as the contract would store it, so equal means equal. */
export function normalise(draft: ProfileDraft): RecordProfile {
  return (setProfileMsg(draft) as { set: RecordProfile }).set
}

function accept(
  address: string,
  record: SignedProfileRecord | null | undefined
): OffchainProfile | undefined {
  if (!record || typeof record.data !== 'string') return undefined
  const body = parseRecordBody(record.data)
  if (typeof body === 'string' || body.address !== address) return undefined
  return { body, record }
}

export async function fetchOffchain(address: string): Promise<OffchainProfile | undefined> {
  const response = await fetch(`${ENDPOINT}?address=${encodeURIComponent(address)}`)
  if (!response.ok) throw new Error(`profile server answered ${response.status}`)
  const reply = (await response.json()) as { record?: SignedProfileRecord | null }
  return accept(address, reply.record)
}

/**
 * Sign and store. `profile: null` stores a tombstone, which is how a removal
 * outranks an older saved copy.
 *
 * One wallet prompt, no fee: the wallet signs a message, not a transaction.
 */
export async function publishOffchain(
  walletId: WalletId,
  address: string,
  profile: RecordProfile | null
): Promise<OffchainProfile> {
  if (profile) {
    const problem = profileProblem(profile)
    if (problem) throw new Error(`This profile cannot be saved: ${problem}.`)
  }

  const wallet = getProvider(walletId)
  if (!wallet?.signArbitrary) {
    throw new Error('This wallet cannot sign messages, so the profile can only be saved with a transaction.')
  }

  const body: ProfileRecordBody = { v: 1, address, signedAt: Date.now(), profile }
  const data = JSON.stringify(body)
  const signed = await wallet.signArbitrary(CHAIN_ID, address, data)
  const record: SignedProfileRecord = { data, signature: signed.signature, pubKey: signed.pub_key.value }

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(record)
  })
  if (!response.ok) {
    const reply = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(
      reply.error
        ? `The profile server refused it: ${reply.error}.`
        : `The profile server answered ${response.status}.`
    )
  }

  return { body, record }
}

/**
 * A starter fee grant from the Secret community faucet, through
 * `api/faucet.ts`: for someone with no SCRT and no gas credits, the one way to
 * pay the fee of the transaction that buys their first credits.
 */

export interface StarterGrant {
  granter: string
  /** What is left of it, in uscrt. */
  spendLimit: bigint
}

const GRANTER_KEY = 'secret-dashboard:faucet-granter'

/**
 * The faucet's granter, once it has granted here. Its allowance is kept for
 * the purchase it was claimed for: the fee payer does not spend it on anything
 * else.
 */
export function faucetGranter(): string | undefined {
  try {
    return localStorage.getItem(GRANTER_KEY) ?? undefined
  } catch {
    return undefined
  }
}

export async function claimStarterGrant(address: string): Promise<StarterGrant> {
  const response = await fetch('/api/faucet', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address })
  })
  const reply = (await response.json().catch(() => ({}))) as {
    granter?: string
    spendLimit?: string
    error?: string
  }
  if (!response.ok || !reply.granter || !reply.spendLimit) {
    throw new Error(reply.error ?? 'The Secret faucet is not granting fees right now.')
  }
  try {
    localStorage.setItem(GRANTER_KEY, reply.granter)
  } catch {
    // Then the fee payer may spend it elsewhere; it is still a free grant.
  }
  return { granter: reply.granter, spendLimit: BigInt(reply.spendLimit) }
}

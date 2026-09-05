import type { SecretNetworkClient } from 'secretjs'

/**
 * Code hashes, read from the chain rather than hardcoded.
 *
 * A Secret contract query is encrypted against the contract's code hash, and a
 * migration changes it. A stale hash does not degrade gracefully — it stops
 * every query on that contract dead, with an error that points at encryption
 * rather than at the config file that is wrong.
 *
 * This is not theoretical: 21 of the 96 hashes in dash.scrt.network's token
 * config were stale when checked against secret-4, sSCRT's among them. So none
 * are stored, and this module is the only way the app obtains one.
 *
 * Cached for the page load, because a hash cannot change without a migration
 * and a migration will not happen mid-session.
 */

const cache = new Map<string, Promise<string>>()

export function codeHashFor(client: SecretNetworkClient, contractAddress: string): Promise<string> {
  const cached = cache.get(contractAddress)
  if (cached) return cached

  const pending = client.query.compute
    .codeHashByContractAddress({ contract_address: contractAddress })
    .then((response) => {
      const hash = response.code_hash
      if (!hash) throw new Error(`${contractAddress} returned no code hash — is it a contract?`)
      return hash
    })
    .catch((error: unknown) => {
      // Never cache a failure; the next attempt should retry.
      cache.delete(contractAddress)
      throw error
    })

  cache.set(contractAddress, pending)
  return pending
}

/**
 * Warm several at once, so a balance list makes one round of requests instead
 * of one per token in series. Failures are kept out of the cache by
 * `codeHashFor`, and reported per address rather than failing the batch — one
 * unreachable contract must not empty the whole screen.
 */
export async function codeHashesFor(
  client: SecretNetworkClient,
  addresses: string[]
): Promise<Map<string, string>> {
  const results = await Promise.allSettled(
    addresses.map(async (address) => [address, await codeHashFor(client, address)] as const)
  )

  const hashes = new Map<string, string>()
  for (const result of results) {
    if (result.status === 'fulfilled') hashes.set(result.value[0], result.value[1])
  }
  return hashes
}

export function forgetCodeHashes(): void {
  cache.clear()
}

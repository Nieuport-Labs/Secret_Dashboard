import type { SecretNetworkClient } from 'secretjs'

import { DENOM } from '@/chains/secret4'

/**
 * Native (bank module) balances.
 *
 * Distinct from SNIP-20 in every way that matters: public, unencrypted, and
 * readable without a permit. It is also the only denomination that can pay gas,
 * which is why an account holding nothing but SNIP-20 tokens is stuck until
 * someone grants it a fee allowance.
 */

/** Native SCRT held by `address`, in base units. Absent means zero, and here that is safe. */
export async function queryNativeBalance(
  client: SecretNetworkClient,
  address: string,
  denom: string = DENOM
): Promise<string> {
  const response = await client.query.bank.balance({ address, denom })
  // The bank module omits the entry entirely for a zero balance rather than
  // returning "0". Unlike a failed SNIP-20 read, this absence really does mean
  // zero — the query succeeded.
  return response.balance?.amount ?? '0'
}

/** Every denomination `address` holds, keyed by denom. IBC vouchers included. */
export async function queryAllBalances(
  client: SecretNetworkClient,
  address: string
): Promise<Map<string, string>> {
  const response = await client.query.bank.allBalances({ address })
  const balances = new Map<string, string>()
  for (const coin of response.balances ?? []) {
    if (coin.denom && coin.amount) balances.set(coin.denom, coin.amount)
  }
  return balances
}

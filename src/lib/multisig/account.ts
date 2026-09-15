/**
 * The two numbers a multisig transaction cannot be built without.
 *
 * `account_number` identifies the account to the chain and `sequence` is its
 * replay counter, and both are inside the document every member signs. That
 * makes them unlike almost everything else this app reads: they are not
 * display, they are part of what is being agreed to, and reading them a second
 * time later does not repair a proposal built on the wrong ones.
 *
 * A multisig address that has never received funds has no account at all —
 * the chain records nothing until something arrives — which is a real state a
 * new group hits immediately and deserves its own answer rather than an
 * exception.
 */

import type { SecretNetworkClient } from 'secretjs'

import { errorMessage, isNotFound } from '@/lib/errors'

export interface AccountMeta {
  accountNumber: string
  sequence: string
}

export class AccountMissingError extends Error {
  constructor(address: string) {
    super(
      `${address} has no account on chain yet. Send it some SCRT first — until something arrives, the chain ` +
        'has no record of it and nothing it signs can be broadcast.'
    )
    this.name = 'AccountMissingError'
  }
}

/**
 * Read from the auth module, unwrapping the two shapes it answers in.
 *
 * secretjs returns the account either bare or wrapped in `{account}` depending
 * on the node's version, and a `BaseAccount` may also arrive wrapped in a
 * vesting or module account. Only the two fields are taken, so a shape this
 * does not recognise fails as "missing" rather than as a type error halfway
 * through building a proposal.
 */
export async function fetchAccountMeta(
  client: SecretNetworkClient,
  address: string
): Promise<AccountMeta | undefined> {
  let response: unknown
  try {
    response = await client.query.auth.account({ address })
  } catch (error) {
    // A never-funded account is reported as not found, which is information
    // rather than a fault. Anything else is a real failure to read the chain.
    //
    // Read through `errorMessage`: secretjs throws the node's JSON body rather
    // than an Error, and `String(error)` on that is "[object Object]" — which
    // matches no pattern, so the absence of an account surfaced as an
    // unreadable crash instead of the ordinary state it is.
    if (isNotFound(error) || /not found|unknown address/i.test(errorMessage(error))) return undefined
    throw error
  }

  const record = (response ?? {}) as Record<string, unknown>
  const account = (record.account ?? record ?? {}) as Record<string, unknown>
  const base = (account.base_account ?? account.base_vesting_account ?? account ?? {}) as Record<
    string,
    unknown
  >

  const accountNumber = base.account_number ?? account.account_number
  const sequence = base.sequence ?? account.sequence

  if (typeof accountNumber !== 'string') return undefined

  return { accountNumber, sequence: typeof sequence === 'string' ? sequence : '0' }
}

export async function requireAccountMeta(client: SecretNetworkClient, address: string): Promise<AccountMeta> {
  const meta = await fetchAccountMeta(client, address)
  if (!meta) throw new AccountMissingError(address)
  return meta
}

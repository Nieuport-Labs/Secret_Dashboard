/**
 * SNIP-24 query permits — what replaces viewing keys here.
 *
 * A viewing key is a password the contract stores, which means setting one is a
 * transaction: a new user has to pay gas before they may read their own
 * balance. A permit is a signature instead. Nothing is written to the chain,
 * nothing is paid, and the contract derives the querier's address from the
 * public key attached to the signature.
 *
 * The document being signed is a cosmos-sdk `StdSignDoc` with every field
 * pinned to a constant, because the constants are what make it a permit rather
 * than a transaction: account number and sequence 0, a zero fee with a gas
 * limit of 1, and an empty memo. A wallet that "helpfully" fills in a real fee
 * or sequence produces a signature the contract will reject, which is why
 * `preferNoSetFee` and `preferNoSetMemo` are passed.
 */

import { CHAIN_ID, DENOM } from '@/chains/secret4'
import type { AminoSignDoc, KeplrLike } from '@/lib/wallet'

/**
 * SNIP-24 names the first four. The last two are Shade's staking derivative's
 * own, and it does *not* define `owner` — its enum is
 * `allowance, balance, history, voting, staking, admin`, so a permit listing
 * `owner` fails to parse there and takes the plain balance read down with it.
 * One permit cannot satisfy both vocabularies; see `STAKING_PERMISSIONS`.
 */
export type PermitPermission = 'balance' | 'history' | 'allowance' | 'owner' | 'voting' | 'staking'

export interface PermitParams {
  permit_name: string
  allowed_tokens: string[]
  chain_id: string
  permissions: PermitPermission[]
}

export interface Permit {
  params: PermitParams
  signature: {
    pub_key: { type: string; value: string }
    signature: string
  }
}

/** Free-form, but it is what the user names when revoking, so make it legible. */
export const PERMIT_NAME = 'secret-dashboard-1.9'

/** Reading balances and transaction history is all a SNIP-20 read needs. */
export const DEFAULT_PERMISSIONS: PermitPermission[] = ['balance', 'history']

/**
 * The second permit, for Shade's staking derivative alone.
 *
 * `staking` is what its `holdings` and `unbonding` queries ask for ("No
 * permission to query staking information"), and no standard SNIP-20 knows the
 * word — a registry-wide permit carrying it would fail to parse at every other
 * contract, exactly as a permit carrying `owner` fails at this one. So the two
 * do not merge: this one names one token, and costs a signature only if the
 * account actually has a position to look at.
 */
export const STAKING_PERMISSIONS: PermitPermission[] = ['balance', 'history', 'staking']

/** Free-form, but it is what the user names when revoking, so keep them apart. */
export const STAKING_PERMIT_NAME = `${PERMIT_NAME}-staking`

const STORAGE_PREFIX = 'secret-dashboard:permit'

/**
 * One key per account per scope. The scope is absent for the registry-wide
 * permit, so the key every existing install already wrote stays exactly as it
 * was and nobody is asked to sign again for a change that is not theirs.
 */
function storageKey(address: string, scope?: string): string {
  return scope
    ? `${STORAGE_PREFIX}:${scope}:${CHAIN_ID}:${address}`
    : `${STORAGE_PREFIX}:${CHAIN_ID}:${address}`
}

/* -------------------------------------------------------------------------- */
/* Signing                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The exact document SNIP-24 specifies. Every constant here is load-bearing;
 * see the module comment before changing one.
 */
export function buildPermitSignDoc(params: PermitParams): AminoSignDoc {
  return {
    chain_id: params.chain_id,
    account_number: '0',
    sequence: '0',
    fee: { amount: [{ denom: DENOM, amount: '0' }], gas: '1' },
    memo: '',
    msgs: [
      {
        type: 'query_permit',
        value: {
          permit_name: params.permit_name,
          allowed_tokens: params.allowed_tokens,
          permissions: params.permissions
        }
      }
    ]
  }
}

export async function signPermit(
  provider: KeplrLike,
  address: string,
  allowedTokens: string[],
  permissions: PermitPermission[] = DEFAULT_PERMISSIONS,
  permitName: string = PERMIT_NAME
): Promise<Permit> {
  const params: PermitParams = {
    permit_name: permitName,
    // Sorted so that two permits covering the same tokens compare equal
    // regardless of the order the registry happened to be in.
    allowed_tokens: [...allowedTokens].sort(),
    chain_id: CHAIN_ID,
    permissions
  }

  const { signature } = await provider.signAmino(CHAIN_ID, address, buildPermitSignDoc(params), {
    preferNoSetFee: true,
    preferNoSetMemo: true
  })

  return { params, signature }
}

/* -------------------------------------------------------------------------- */
/* Storage                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Every read and write is guarded: in a private window, or with site data
 * blocked, the accessor itself throws rather than returning empty. A missing
 * permit is a normal state — the user signs again — so a storage failure must
 * degrade to that, never to a broken page.
 */
export function loadPermit(address: string, scope?: string): Permit | undefined {
  try {
    const raw = localStorage.getItem(storageKey(address, scope))
    if (!raw) return undefined

    const permit = JSON.parse(raw) as Permit
    if (!permit?.params?.allowed_tokens || !permit?.signature?.signature) return undefined
    // A permit signed for another chain is not usable here.
    if (permit.params.chain_id !== CHAIN_ID) return undefined

    return permit
  } catch {
    return undefined
  }
}

export function savePermit(address: string, permit: Permit, scope?: string): void {
  try {
    localStorage.setItem(storageKey(address, scope), JSON.stringify(permit))
  } catch {
    // Not fatal: the permit stays usable for this page load, and the user is
    // asked to sign again next time rather than being blocked now.
  }
}

export function forgetPermit(address: string, scope?: string): void {
  try {
    localStorage.removeItem(storageKey(address, scope))
  } catch {
    /* nothing to do */
  }
}

/* -------------------------------------------------------------------------- */
/* Coverage                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Whether a stored permit actually covers a token.
 *
 * This is the subtle part of using one permit for a whole registry: the signed
 * document names its tokens, so a token added to the registry after the permit
 * was signed is *not* covered, and querying it returns an error that looks like
 * a node fault. Checking up front turns that into an honest "re-sign to include
 * this token".
 */
export function covers(permit: Permit | undefined, tokenAddress: string): boolean {
  return permit?.params.allowed_tokens.includes(tokenAddress) ?? false
}

export function missingTokens(permit: Permit | undefined, tokenAddresses: string[]): string[] {
  if (!permit) return [...tokenAddresses]
  const allowed = new Set(permit.params.allowed_tokens)
  return tokenAddresses.filter((address) => !allowed.has(address))
}

export function hasPermission(permit: Permit | undefined, permission: PermitPermission): boolean {
  return permit?.params.permissions.includes(permission) ?? false
}

/**
 * Permissions a stored permit is missing.
 *
 * The other half of coverage, and the half that is easy to forget: a permit is
 * a signed document, so widening what this app reads widens what it has to ask
 * for, and a permit signed before that change is as unusable for the new read
 * as one signed before a token existed. Judging staleness by tokens alone let a
 * permit look current while a screen it could not answer sat there failing.
 */
/**
 * Permissions a stored permit carries that this app did not ask for.
 *
 * Not pedantry: a permission is rejected at *parse* time by a contract that
 * does not define it, so one surplus word makes the permit useless at that
 * contract rather than merely over-broad. This dashboard shipped a permit
 * carrying `owner` for exactly one afternoon, and every account that signed one
 * in that window holds a permit stkd-SCRT will refuse forever. Anything signed
 * outside what the scope asks for is therefore treated as not signed at all.
 */
export function surplusPermissions(
  permit: Permit | undefined,
  allowed: PermitPermission[] = DEFAULT_PERMISSIONS
): PermitPermission[] {
  if (!permit) return []
  const wanted = new Set<string>(allowed)
  return permit.params.permissions.filter((permission) => !wanted.has(permission))
}

export function missingPermissions(
  permit: Permit | undefined,
  required: PermitPermission[] = DEFAULT_PERMISSIONS
): PermitPermission[] {
  if (!permit) return [...required]
  const granted = new Set(permit.params.permissions)
  return required.filter((permission) => !granted.has(permission))
}

/* -------------------------------------------------------------------------- */
/* Query wrapping                                                              */
/* -------------------------------------------------------------------------- */

/** Wrap a SNIP-20 query so the contract authenticates it against the permit. */
export function withPermit<Q extends object>(
  permit: Permit,
  query: Q
): { with_permit: { permit: Permit; query: Q } } {
  return { with_permit: { permit, query } }
}

/**
 * The execute message that invalidates a permit on chain.
 *
 * Worth knowing before offering it: revoking is a transaction, and it revokes
 * by *name*. Signing a new permit under the same name after revoking that name
 * produces a permit the contract still refuses.
 */
export function revokePermitMsg(permitName: string = PERMIT_NAME): {
  revoke_permit: { permit_name: string }
} {
  return { revoke_permit: { permit_name: permitName } }
}

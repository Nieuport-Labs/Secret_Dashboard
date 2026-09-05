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

export type PermitPermission = 'balance' | 'history' | 'allowance' | 'owner'

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

/** Reading balances and transaction history is all this dashboard needs. */
export const DEFAULT_PERMISSIONS: PermitPermission[] = ['balance', 'history']

const STORAGE_PREFIX = 'secret-dashboard:permit'

function storageKey(address: string): string {
  return `${STORAGE_PREFIX}:${CHAIN_ID}:${address}`
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
  permissions: PermitPermission[] = DEFAULT_PERMISSIONS
): Promise<Permit> {
  const params: PermitParams = {
    permit_name: PERMIT_NAME,
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
export function loadPermit(address: string): Permit | undefined {
  try {
    const raw = localStorage.getItem(storageKey(address))
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

export function savePermit(address: string, permit: Permit): void {
  try {
    localStorage.setItem(storageKey(address), JSON.stringify(permit))
  } catch {
    // Not fatal: the permit stays usable for this page load, and the user is
    // asked to sign again next time rather than being blocked now.
  }
}

export function forgetPermit(address: string): void {
  try {
    localStorage.removeItem(storageKey(address))
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

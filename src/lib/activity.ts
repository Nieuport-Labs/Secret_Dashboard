import { DECIMALS, DENOM, DISPLAY_DENOM, IBC_HOOKS_WRAPPER } from '@/chains/secret4'
import type { PublicTransfer } from '@/lib/publicHistory'
import { tokenByAddress, type TokenInfo } from '@/tokens/registry'
import { tokenAddressForBankDenom } from '@/tokens/routes'

/**
 * Turning chain movements into things a person did.
 *
 * Kept apart from the hook that fetches them because the interesting part is
 * not the fetching: it is deciding that a transaction which unwrapped a token
 * and sent it over IBC is *one* event called "bridged out", not two called
 * "received" and "sent". That judgement is worth testing against captured
 * transactions, and a hook cannot be.
 */

export type ActivityKind =
  | 'received'
  | 'sent'
  /** Public funds that went into their own SNIP-20 contract — made private. */
  | 'wrapped'
  /** …and back out of it. */
  | 'unwrapped'
  | 'bridged-in'
  | 'bridged-out'
  | 'received-private'
  | 'sent-private'

export interface ActivityEntry {
  id: string
  kind: ActivityKind
  private: boolean
  /** Registry entry, when the asset is one this app knows about. */
  token?: TokenInfo
  symbol: string
  /**
   * Absent for a voucher no registry entry claims: its decimal places are not
   * knowable from the denomination, and a figure scaled by a guess is worse
   * than one shown in base units and labelled as such.
   */
  decimals?: number
  /** Base units. */
  amount: string
  counterparty?: string
  /** Seconds since the epoch. Absent on contracts that do not record it. */
  at?: number
  /** Public entries only. A private transfer is not on any explorer. */
  hash?: string
}

/** `ibc/0954E1C2…` is not a name anyone reads; show enough to recognise it. */
export function shortDenom(denom: string): string {
  return denom.startsWith('ibc/') ? `IBC ${denom.slice(4, 10)}…` : denom
}

/**
 * Whether an address is a piece of this app's own machinery rather than a
 * counterparty — the token contract the funds were wrapped into, any other
 * SNIP-20, or the ibc-hooks wrapper a deposit is addressed to.
 *
 * "Sent 5 SCRT to secret1k0jnty…" is a true sentence about a wrap and a
 * useless one to read.
 */
function ownAddress(address: string, contract?: string): boolean {
  return address === contract || address === IBC_HOOKS_WRAPPER || tokenByAddress(address) !== undefined
}

/**
 * One transaction, one thing that happened — even when the chain records it as
 * several movements of the same coin.
 *
 * Bridging out a private token unwraps and sends in a single transaction, so
 * the bank module sees the money arrive from the SNIP-20 contract and leave to
 * the IBC escrow; a deposit that wraps on arrival is the mirror of it. Listing
 * both legs describes the plumbing rather than the act, and puts two rows in
 * the feed for something the user did once.
 *
 * Movements to genuinely different people in one transaction stay separate,
 * because those really are separate payments.
 */
export function summarisePublicTransfers(transfers: PublicTransfer[]): ActivityEntry[] {
  const groups = new Map<string, PublicTransfer[]>()
  for (const transfer of transfers) {
    const key = `${transfer.hash}:${transfer.denom}`
    groups.set(key, [...(groups.get(key) ?? []), transfer])
  }

  const found: ActivityEntry[] = []

  for (const [key, legs] of groups) {
    const denom = legs[0].denom
    const contract = tokenAddressForBankDenom(denom)
    const token = contract ? tokenByAddress(contract) : undefined
    const native = denom === DENOM

    const describe = (kind: ActivityKind, leg: PublicTransfer, suffix = '') => {
      found.push({
        id: `bank:${key}:${suffix || kind}`,
        kind,
        private: false,
        token,
        symbol: native ? DISPLAY_DENOM : (token?.symbol ?? shortDenom(denom)),
        decimals: native ? DECIMALS : token?.decimals,
        amount: leg.amount,
        counterparty: ownAddress(leg.counterparty, contract) ? undefined : leg.counterparty,
        at: leg.at,
        hash: leg.hash
      })
    }

    if (legs.some((leg) => leg.ibc)) {
      /*
       * The leg that crossed the boundary is the one whose counterparty is not
       * one of our own contracts — the escrow. The other leg, when there is
       * one, is the wrap or unwrap that rode along with it, and it is the
       * bridge that the user meant to do.
       */
      const crossing = legs.find((leg) => !ownAddress(leg.counterparty, contract)) ?? legs[0]
      describe(crossing.direction === 'in' ? 'bridged-in' : 'bridged-out', crossing)
      continue
    }

    const ownLeg = contract ? legs.find((leg) => leg.counterparty === contract) : undefined
    if (ownLeg) {
      describe(ownLeg.direction === 'out' ? 'wrapped' : 'unwrapped', ownLeg)
      continue
    }

    legs.forEach((leg, index) => {
      describe(leg.direction === 'in' ? 'received' : 'sent', leg, `${index}`)
    })
  }

  return found
}

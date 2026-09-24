import { DENOM } from '@/chains/secret4'
import { SOURCE_CHAINS, type SourceChain } from '@/chains/sources'
import { decodeBech32 } from '@/lib/bech32'
import { bankDenomFor, withdrawRoute } from '@/tokens/routes'

/**
 * Sending to an address on another chain, straight from Send.
 *
 * The address says where it goes: a bech32 prefix names its chain, so a
 * `cosmos1…` recipient means Cosmos Hub the same way a `secret1…` one means
 * Secret. From there it is the bridge's withdrawal, unwrap included, without
 * making someone go and find the Bridge page to pay a friend on Osmosis.
 */

export type Destination =
  | { kind: 'secret' }
  | { kind: 'chain'; chain: SourceChain }
  /** A valid address on a chain this dashboard has no channel to. */
  | { kind: 'unknown'; prefix: string }
  | { kind: 'invalid' }

const BY_PREFIX = new Map(SOURCE_CHAINS.map((chain) => [chain.prefix, chain]))

export function destinationOf(address: string): Destination {
  const decoded = decodeBech32(address)
  // Every account key on these chains is 20 bytes, bar the 32-byte contract
  // and module accounts. Anything else is a validator key or a typo that
  // happened to pass the checksum.
  if (!decoded || (decoded.bytes.length !== 20 && decoded.bytes.length !== 32)) return { kind: 'invalid' }
  if (decoded.prefix === 'secret') return { kind: 'secret' }
  const chain = BY_PREFIX.get(decoded.prefix)
  return chain ? { kind: 'chain', chain } : { kind: 'unknown', prefix: decoded.prefix }
}

export interface IbcAsset {
  /** The SNIP-20 this asset is a form of; sSCRT for native SCRT. */
  token: string
  /** Held as the SNIP-20 rather than the bank denomination. */
  private: boolean
  /** Bank denomination, on the public ones. */
  denom?: string
}

export type IbcPlan =
  | {
      ok: true
      /** What leaves Secret, as Secret's bank module calls it. */
      denom: string
      channel?: string
      /** SNIP-20 to unwrap in the same transaction, for a private balance. */
      unwrap?: string
    }
  | { ok: false }

/**
 * How this asset reaches that chain, or that it cannot.
 *
 * Only a route whose denomination is the very coin being spent is accepted.
 * A token that arrived over two channels wears two vouchers, and sending the
 * one someone holds down the other's channel delivers something nobody on the
 * far side recognises. Secret's own tokens — SHD, SILK — leave through a
 * contract of their own rather than the transfer module and are not offered
 * here at all; the Bridge page is where those go.
 */
export function planIbcSend(asset: IbcAsset, chain: SourceChain): IbcPlan {
  const route = withdrawRoute(asset.token, chain.chainId)
  if (!route) return { ok: false }

  const spent = asset.private ? bankDenomFor(asset.token) : asset.denom
  if (!spent || route.denom !== spent) return { ok: false }
  if (spent !== DENOM && !spent.startsWith('ibc/')) return { ok: false }

  return { ok: true, denom: spent, channel: route.channel, unwrap: asset.private ? asset.token : undefined }
}

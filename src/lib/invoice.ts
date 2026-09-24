import { DECIMALS, DENOM, DISPLAY_DENOM } from '@/chains/secret4'
import { isValidBech32 } from '@/lib/bech32'
import { toBaseUnits } from '@/lib/format'
import { bankDenomFor } from '@/tokens/routes'
import { allTokens, privateSymbol, tokenByAddress, tokenImageUrl } from '@/tokens/registry'

/**
 * Invoices: a request for a set amount of one asset, paid to one address.
 *
 * Nothing is stored anywhere. An invoice *is* its link — the address, the
 * asset and the amount travel in it — so creating one costs nothing, needs no
 * server, and cannot be edited after it has been handed out. The flip side is
 * that it proves nothing on its own: whoever opens it is shown what the link
 * says, and the pay page says who it pays so that can be checked.
 *
 * An asset is named by what the chain names it by, so the id is the same
 * string whether it is read by this app or by anything else:
 *
 * - `uscrt` — native SCRT, sent through the bank module;
 * - `ibc/…` — a public IBC voucher, also through the bank module;
 * - `secret1…` — a SNIP-20 contract, sent privately.
 */

export interface InvoiceAsset {
  id: string
  symbol: string
  detail: string
  image?: string
  decimals: number
  private: boolean
  /** CoinGecko id, for the fiat view. Absent means unpriced. */
  priceId?: string
}

const NATIVE: InvoiceAsset = {
  id: DENOM,
  symbol: DISPLAY_DENOM,
  detail: 'Public — visible to anyone',
  image: '/img/secret-mark.svg',
  decimals: DECIMALS,
  private: false,
  priceId: 'secret'
}

/**
 * Everything an invoice can ask for: native SCRT, every known SNIP-20 in its
 * private form, and the public voucher behind each one that has a single
 * unambiguous bank denomination (see `bankDenomFor`). Native first, then the
 * private forms — the ones this chain exists for — then the public vouchers.
 */
export function invoiceAssets(): InvoiceAsset[] {
  const tokens = allTokens()
  const privateForms = tokens.map((token) => ({
    id: token.address,
    symbol: privateSymbol(token),
    detail: `Private · ${token.description ?? 'SNIP-20'}`,
    image: tokenImageUrl(token),
    decimals: token.decimals,
    private: true,
    priceId: token.coingeckoId
  }))
  const publicForms = tokens.flatMap((token) => {
    const denom = bankDenomFor(token.address)
    if (!denom || denom === DENOM) return []
    return [
      {
        id: denom,
        symbol: token.symbol,
        detail: `Public · ${token.description ?? 'IBC voucher'}`,
        image: tokenImageUrl(token),
        decimals: token.decimals,
        private: false,
        priceId: token.coingeckoId
      }
    ]
  })
  return [NATIVE, ...privateForms, ...publicForms]
}

/** One asset by id, or `undefined` for an id this app cannot name. */
export function invoiceAsset(id: string): InvoiceAsset | undefined {
  if (id === DENOM) return NATIVE
  if (id.startsWith('secret1')) {
    const token = tokenByAddress(id)
    return token ? invoiceAssets().find((asset) => asset.id === token.address) : undefined
  }
  return invoiceAssets().find((asset) => asset.id === id)
}

/**
 * The id the send form uses for the same asset. The send form names native
 * `native` and vouchers `bank:<denom>`, because it also lists balances that
 * have no invoice id at all; the two are mapped here rather than unified.
 */
export function sendAssetId(id: string): string {
  if (id === DENOM) return 'native'
  if (id.startsWith('ibc/')) return `bank:${id}`
  return id
}

export interface Invoice {
  to: string
  asset: InvoiceAsset
  /** Whole units as typed, e.g. `12.5`. */
  amount: string
}

function query(invoice: Invoice): string {
  return new URLSearchParams({ asset: invoice.asset.id, amount: invoice.amount }).toString()
}

/**
 * The payment URI, BIP-21 shaped: `secret:<address>?asset=…&amount=…`.
 *
 * There is no settled payment-URI standard on Cosmos chains, so this follows
 * the one most wallets already recognise the shape of. The amount is in whole
 * units, as in BIP-21, not base units — it is read by people as well as parsed.
 */
export function invoiceUri(invoice: Invoice): string {
  return `secret:${invoice.to}?${query(invoice)}`
}

export function invoicePath(invoice: Invoice): string {
  return `/pay/${invoice.to}?${query(invoice)}`
}

/** Built from the live origin, for the same reason as `profileUrl`. */
export function invoiceUrl(invoice: Invoice): string {
  return `${window.location.origin}${invoicePath(invoice)}`
}

/** Base units for an amount, or `undefined` when it is not a positive amount of this asset. */
export function invoiceBaseUnits(amount: string, decimals: number): string | undefined {
  try {
    const base = toBaseUnits(amount, decimals)
    return BigInt(base) > 0n ? base : undefined
  } catch {
    return undefined
  }
}

/**
 * An invoice read back out of a pay link, or the reason it cannot be.
 *
 * Every part is checked, not just present: a link is typed, truncated and
 * forwarded by people, and a pay page that shows a garbled amount as if it
 * were the real one is worse than one that refuses.
 */
export function parseInvoice(to: string, params: URLSearchParams): { invoice: Invoice } | { error: string } {
  if (!isValidBech32(to, 'secret'))
    return { error: 'The address in this link is not a valid Secret address.' }

  const asset = invoiceAsset(params.get('asset') ?? '')
  if (!asset) return { error: 'This link asks for an asset this dashboard does not know.' }

  const amount = (params.get('amount') ?? '').trim()
  if (!invoiceBaseUnits(amount, asset.decimals))
    return { error: 'The amount in this link is missing or invalid.' }

  return { invoice: { to, asset, amount } }
}

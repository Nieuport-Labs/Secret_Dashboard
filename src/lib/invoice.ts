import {
  encodePaymentLink,
  encodePaymentUri,
  isExpired,
  newInvoiceId,
  normalizeAmount,
  parsePayment,
  paymentMemo,
  type ParseErrorCode,
  type PaymentRequest
} from 'secret-pay'

import { CHAIN_ID, DECIMALS, DENOM, DISPLAY_DENOM } from '@/chains/secret4'
import { toBaseUnits } from '@/lib/format'
import { bankDenomFor } from '@/tokens/routes'
import { allTokens, privateSymbol, tokenByAddress, tokenImageUrl } from '@/tokens/registry'

/**
 * Invoices: a request for a set amount of one asset, paid to one address.
 *
 * The format is `secret-pay`'s (`packages/secret-pay`, shared with DarkShell):
 * a `PaymentRequest` of chain, address, asset, amount and an `INV-…` id, with
 * an optional expiry and message. The payer sends the id back as the SNIP-20
 * transfer's memo, which is how the recipient tells the payment apart.
 *
 * Nothing is stored anywhere. An invoice *is* its link — everything above
 * travels in it — so creating one costs nothing, needs no
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

/** The longest `message` this dashboard writes into an invoice. */
export const MAX_MESSAGE = 140

/** How long an invoice can be paid for. `0` writes no `exp` at all — the default. */
export const VALIDITY = [
  { seconds: 3600, label: '1 hour' },
  { seconds: 86_400, label: '1 day' },
  { seconds: 604_800, label: '1 week' },
  { seconds: 0, label: 'Never' }
] as const

/**
 * A payment request, as `secret-pay` defines it, with what this app needs to
 * act on it read out once. `request` is the part that travels — the QR code and
 * the link are encoded from it and nothing else.
 */
export interface Invoice {
  request: PaymentRequest
  to: string
  asset: InvoiceAsset
  /** Whole units, normalised by `secret-pay`, e.g. `12.5`. */
  amount: string
  /**
   * What the payer must send as the SNIP-20 transfer's memo — the invoice id —
   * or `undefined` for a plain request with no reference, such as a tip.
   */
  memo?: string
}

function fromRequest(request: PaymentRequest, asset: InvoiceAsset): Invoice {
  return { request, to: request.address, asset, amount: request.amount ?? '', memo: paymentMemo(request) }
}

/**
 * A new invoice, in the same format DarkShell writes: a fresh `INV-…` id that
 * the payer sends back as the transfer memo, so the recipient can tell which
 * payment settled it. The amount is the caller's, already checked against the
 * asset's decimals; `validity` is seconds from now, `0` for no expiry.
 */
export function newInvoice(params: {
  to: string
  asset: InvoiceAsset
  amount: string
  validity: number
  message?: string
}): Invoice {
  const amount = normalizeAmount(params.amount)
  if (!amount) throw new Error('Not an amount.')
  const message = params.message?.trim().slice(0, MAX_MESSAGE)
  const request: PaymentRequest = {
    chain: CHAIN_ID,
    address: params.to,
    asset: params.asset.id,
    amount,
    id: newInvoiceId(),
    ...(params.validity ? { exp: Math.floor(Date.now() / 1000) + params.validity } : {}),
    ...(message ? { message } : {})
  }
  return fromRequest(request, params.asset)
}

/**
 * A request with no reference and no expiry: an amount of an asset, to an
 * address. What paying from a phone shows — a tip, which nobody has to match
 * against anything afterwards.
 */
export function paymentRequest(to: string, asset: InvoiceAsset, amount: string): Invoice {
  const normalized = normalizeAmount(amount)
  if (!normalized) throw new Error('Not an amount.')
  return fromRequest({ chain: CHAIN_ID, address: to, asset: asset.id, amount: normalized }, asset)
}

/**
 * `secret:<address>?…` — what goes into the QR code. `secret-pay` 1.1 writes
 * the URI without a scheme; the dashboard keeps `secret:` in its QR codes so a
 * phone's camera still offers to open a wallet (readers accept both).
 */
export function invoiceUri(invoice: Invoice): string {
  return `secret:${encodePaymentUri(invoice.request)}`
}

/** The shareable `/pay/…` link, built from the live origin, for the same reason as `profileUrl`. */
export function invoiceUrl(invoice: Invoice): string {
  return encodePaymentLink(window.location.origin, invoice.request)
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

const PARSE_ERRORS: Record<ParseErrorCode, string> = {
  empty: 'There is nothing to read.',
  unrecognized: 'This is not a payment link or URI.',
  bad_address: 'The address in this link is not a valid Secret address.',
  wrong_chain: 'The address in this link is for another chain.',
  bad_asset: 'The asset in this link is not a valid asset id.',
  unknown_asset: 'This link asks for an asset this dashboard does not know.',
  bad_amount: 'The amount in this link is invalid.',
  too_many_decimals: 'The amount in this link has more decimal places than its asset.',
  bad_exp: 'The expiry in this link is invalid.',
  bad_return: 'The page this link returns to is not a secure (https) address.',
  memo_too_long: 'The reference in this link is too long.',
  duplicate_param: 'This link names the same parameter twice.',
  unsupported_required_param: 'This link needs a feature this dashboard does not support.'
}

/** Whether `exp` has passed. Checked again right before signing, not only when the link was read. */
export function invoiceExpired(invoice: Invoice): boolean {
  return isExpired(invoice.request)
}

/** When the invoice stops being payable, for display; `undefined` when it never does. */
export function invoiceExpiry(invoice: Invoice): Date | undefined {
  return invoice.request.exp === undefined ? undefined : new Date(invoice.request.exp * 1000)
}

/**
 * An invoice read back out of whatever was scanned or pasted — a `secret:` URI
 * or a `/pay/…` link, from this app or from DarkShell — or the reason it
 * cannot be paid.
 *
 * `secret-pay` checks the format; this checks it against this app: the chain
 * it is connected to, an asset it can name and scale, an amount, and an expiry
 * that has not passed. Every part is checked, not just present: a link is
 * typed, truncated and forwarded by people, and a pay page that shows a
 * garbled amount as if it were the real one is worse than one that refuses.
 */
export function readInvoice(input: string): { invoice: Invoice } | { error: string } {
  const parsed = parsePayment(input)
  if (!parsed.ok) return { error: PARSE_ERRORS[parsed.error] }
  const { request } = parsed

  if (request.chain !== CHAIN_ID) return { error: `This invoice is for ${request.chain}, not ${CHAIN_ID}.` }

  const asset = request.asset ? invoiceAsset(request.asset) : undefined
  if (!asset) return { error: PARSE_ERRORS.unknown_asset }

  if (!request.amount || !invoiceBaseUnits(request.amount, asset.decimals))
    return { error: 'The amount in this link is missing or invalid.' }

  const invoice = fromRequest(request, asset)

  // The reference only means something to the recipient if it arrives with
  // the payment, and the one place it can ride privately is the SNIP-20
  // transfer's memo. A bank send has none.
  if (invoice.memo !== undefined && !asset.private)
    return { error: `This invoice asks for public ${asset.symbol}, which cannot carry its reference.` }

  if (invoiceExpired(invoice)) return { error: 'This invoice has expired.' }

  return { invoice }
}

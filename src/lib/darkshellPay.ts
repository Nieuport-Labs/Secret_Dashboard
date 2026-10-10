import { checkout, readReturn, type ReturnResult } from 'secret-pay/checkout'

import type { Invoice } from '@/lib/invoice'

/**
 * Paying an invoice with DarkShell on the same phone: a link opens DarkShell's
 * payment sheet over the browser (amount, Confirm, fingerprint) and, once paid,
 * DarkShell brings the payer back to this page with the outcome appended
 * (`secret_pay`, `tx`, `id` — `secret-pay` SPEC §6a).
 *
 * On Android the link is an `intent://` URL: without DarkShell installed,
 * Chrome stays on this page instead of showing an error.
 */

/** Only Android has the payment sheet; elsewhere the QR code is the way to pay from a phone. */
export function canPayWithDarkShell(): boolean {
  return /Android/i.test(navigator.userAgent)
}

/** This page without an earlier outcome, so coming back twice does not stack parameters. */
function returnUrl(): string {
  return withoutReturn(window.location.href)
}

/** The URL that opens DarkShell with this invoice. Navigate to it from a click. */
export function darkShellUrl(invoice: Invoice): string {
  return checkout(invoice.request, { returnUrl: returnUrl(), fallbackOrigin: window.location.origin }).url
}

/**
 * What DarkShell said when it brought the payer back, for this invoice only.
 * A hint, not proof: anyone can open the page with these parameters, so the
 * transaction is looked up on chain before anything says "paid".
 */
export function returnedFor(invoice: Invoice): ReturnResult | null {
  const r = readReturn(window.location.href)
  if (!r) return null
  if (invoice.request.id && r.id && r.id !== invoice.request.id) return null
  return r
}

/**
 * The page's link without DarkShell's outcome. The invoice's own `id` is the
 * same value DarkShell sends back, so only `secret_pay` and `tx` are removed.
 */
export function withoutReturn(href: string): string {
  const url = new URL(href)
  if (!url.searchParams.has('secret_pay')) return href
  url.searchParams.delete('secret_pay')
  url.searchParams.delete('tx')
  return url.toString()
}

export type TxState = 'pending' | 'confirmed' | 'failed' | 'other'

interface TxBody {
  tx_response?: { code?: number }
  tx?: { body?: { messages?: Array<{ '@type'?: string; contract?: string; to_address?: string }> } }
}

/**
 * A transaction's state from the LCD, checked against the invoice as far as the
 * chain shows it: a private payment must call the invoice's token contract (the
 * recipient and amount inside are encrypted), a public one must send to the
 * payee. `other` is a transaction that is not a payment of this invoice.
 */
export async function txState(lcd: string, hash: string, invoice: Invoice): Promise<TxState> {
  const response = await fetch(`${lcd.replace(/\/+$/, '')}/cosmos/tx/v1beta1/txs/${hash}`)
  if (response.status === 404 || response.status === 400) return 'pending'
  if (!response.ok) throw new Error(`LCD ${response.status}`)
  const body = (await response.json()) as TxBody
  if (!body.tx_response) return 'pending'
  const messages = body.tx?.body?.messages ?? []
  const matches = invoice.asset.private
    ? messages.some((m) => m.contract === invoice.asset.id)
    : messages.some((m) => m.to_address === invoice.to)
  if (!matches) return 'other'
  return body.tx_response.code ? 'failed' : 'confirmed'
}

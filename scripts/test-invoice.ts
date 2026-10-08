/**
 * Tests for invoices in the `secret-pay` format shared with DarkShell.
 *
 * What is checked is the round trip — an invoice made here reads back the same
 * from its URI and its link — and the refusals that stand between a link and a
 * signature: another chain, an expired invoice, an id that a public asset
 * could not carry, and a link from before invoices had ids, which still opens.
 *
 *   npm run test:invoice
 */

import { encodePaymentUri } from 'secret-pay'

import { DENOM } from '../src/chains/secret4.ts'
import {
  invoiceAsset,
  invoiceAssets,
  invoiceUri,
  MAX_MESSAGE,
  newInvoice,
  readInvoice
} from '../src/lib/invoice.ts'
import { transferMsg } from '../src/lib/snip20.ts'

let passed = 0
let failed = 0

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1
    return
  }
  failed += 1
  console.log(`FAIL  ${name}`)
  if (detail !== undefined) console.log(`      ${JSON.stringify(detail)}`)
}

const TO = 'secret16dyfc744j0lrhae0xpfjxl5cnx2hu80h0p0rad'
const SSCRT = 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek'
const sscrt = invoiceAsset(SSCRT)!
const now = Math.floor(Date.now() / 1000)

/* Made here, read back. */
{
  const made = newInvoice({ to: TO, asset: sscrt, amount: '12.50', validity: 3600, message: ' Table 4 ' })
  const { request } = made
  check('chain', request.chain === 'secret-4', request)
  check('amount normalised', request.amount === '12.5', request)
  check('id shape', /^INV-[0-9A-HJKMNP-TV-Z]{8}$/.test(request.id ?? ''), request)
  check('exp about an hour out', Math.abs((request.exp ?? 0) - (now + 3600)) <= 2, request)
  check('message trimmed', request.message === 'Table 4', request)
  check('memo is the id', made.memo === request.id, made)

  const fromUri = readInvoice(invoiceUri(made))
  check('uri reads back', 'invoice' in fromUri && fromUri.invoice.memo === request.id, fromUri)
  const link = `https://dash.example/pay/${TO}?${invoiceUri(made).split('?')[1]}`
  const fromLink = readInvoice(link)
  check(
    'link reads back',
    'invoice' in fromLink &&
      fromLink.invoice.amount === '12.5' &&
      fromLink.invoice.asset.id === SSCRT &&
      fromLink.invoice.request.message === 'Table 4',
    fromLink
  )
}

/* Never: no exp at all. */
{
  const made = newInvoice({ to: TO, asset: sscrt, amount: '1', validity: 0 })
  check('never writes no exp', !('exp' in made.request) && !invoiceUri(made).includes('exp='), made.request)
  check('no message, no key', !invoiceUri(made).includes('message='), invoiceUri(made))
}

/* The description is capped. */
{
  const made = newInvoice({ to: TO, asset: sscrt, amount: '1', validity: 0, message: 'x'.repeat(200) })
  check('message capped', made.request.message?.length === MAX_MESSAGE, made.request.message?.length)
}

/* DarkShell's own example from SPEC.md, with the sSCRT alias. */
{
  const read = readInvoice(
    `secret:${TO}?asset=sscrt&amount=12.5&id=INV-7Q2M9K4D&exp=${now + 600}&label=Corner%20Cafe&message=Table%204`
  )
  check('darkshell invoice', 'invoice' in read && read.invoice.memo === 'INV-7Q2M9K4D', read)
}

/* Refusals. */
{
  const expired = readInvoice(`secret:${TO}?asset=${SSCRT}&amount=1&id=INV-AAAAAAAA&exp=${now - 1}`)
  check('expired refused', 'error' in expired && /expired/.test(expired.error), expired)

  const testnet = readInvoice(`secret:${TO}?asset=uscrt&amount=1&chain=pulsar-3`)
  check('other chain refused', 'error' in testnet && /pulsar-3/.test(testnet.error), testnet)

  const publicWithId = readInvoice(`secret:${TO}?asset=${DENOM}&amount=1&id=INV-AAAAAAAA`)
  check('public asset with id refused', 'error' in publicWithId, publicWithId)

  const noAmount = readInvoice(`secret:${TO}?asset=${SSCRT}`)
  check('no amount refused', 'error' in noAmount, noAmount)

  const unknown = readInvoice(
    `secret:${TO}?asset=secret1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq`
  )
  check('unknown asset refused', 'error' in unknown, unknown)
}

/* A link from before invoices had ids still opens, and needs no memo. */
{
  const old = readInvoice(`https://dash.example/pay/${TO}?asset=${DENOM}&amount=2.5`)
  check(
    'old link reads',
    'invoice' in old && old.invoice.memo === undefined && !old.invoice.asset.private,
    old
  )
}

/* Every private asset this app offers encodes to something it reads back. */
for (const asset of invoiceAssets().filter((option) => option.private)) {
  const uri = encodePaymentUri({ chain: 'secret-4', address: TO, asset: asset.id, amount: '1', id: 'INV-X' })
  const read = readInvoice(uri)
  check(`round trip ${asset.symbol}`, 'invoice' in read && read.invoice.asset.id === asset.id, read)
}

/* The memo rides inside the SNIP-20 transfer, and only when there is one. */
check(
  'transfer with memo',
  JSON.stringify(transferMsg(TO, '1', 'INV-X')) ===
    JSON.stringify({ transfer: { recipient: TO, amount: '1', memo: 'INV-X' } })
)
check('transfer without memo', !('memo' in transferMsg(TO, '1').transfer))

console.log(`${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)

# secret-pay

Payment requests and invoices for Secret Network as one URI format, plus a zero-dependency TypeScript reference implementation.

```
secret:secret16dyfc744j0lrhae0xpfjxl5cnx2hu80h0p0rad?asset=sscrt          receiving address, sSCRT only
secret16dyfc744j0lrhae0xpfjxl5cnx2hu80h0p0rad:sSCRT                       the same, short human form
secret:secret16dyf…0rad?asset=secret1k0jn…fzek&amount=12.5&id=INV-7Q2M9K4D&exp=1893456000    invoice
https://<host>/pay/secret16dyf…0rad?asset=…&amount=12.5&id=…             invoice as a web link
```

Compatible with links from [Secret_Dashboard](https://github.com/Nieuport-Labs/Secret_Dashboard). Full rules: [SPEC.md](./SPEC.md).

## Install

```bash
npm install secret-pay
```

## Use

```ts
import { parsePayment, encodePaymentUri, encodePaymentLink, formatShort, newInvoiceId, paymentMemo, findSettlement } from 'secret-pay';

// create an invoice
const invoice = {
	chain: 'secret-4',
	address: 'secret16dyfc744j0lrhae0xpfjxl5cnx2hu80h0p0rad',
	asset: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek', // sSCRT
	amount: '12.5',
	id: newInvoiceId(),
	exp: Math.floor(Date.now() / 1000) + 3600,
};
encodePaymentUri(invoice);                       // for the QR code
encodePaymentLink('https://pay.example', invoice); // for sharing

// read whatever the user scanned or pasted
const r = parsePayment(scanned);
if (r.ok) {
	r.request.amount;            // "12.5"
	paymentMemo(r.request);      // memo to attach to the transfer
} else {
	r.error;                     // 'bad_address' | 'unknown_asset' | …
}

// recipient side: did it get paid?
findSettlement(invoice, receivedTransfers).status; // 'paid' | 'underpaid' | 'late' | 'no_match'
```

## Develop

```bash
npm test
npm run build
```

## License

MIT

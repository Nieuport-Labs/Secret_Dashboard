# secret-pay

Payment requests and invoices for Secret Network as one URI format, plus a zero-dependency TypeScript reference implementation.

```
secret16dyfc744j0lrhae0xpfjxl5cnx2hu80h0p0rad?asset=sscrt                 receiving address, sSCRT only
secret16dyfc744j0lrhae0xpfjxl5cnx2hu80h0p0rad:sSCRT                       the same, short human form
secret16dyf…0rad?asset=secret1k0jn…fzek&amount=12.5&id=INV-7Q2M9K4D&exp=1893456000    invoice
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

## Take payments on a web page

`secret-pay/checkout` opens the payer's Secret wallet with the request and brings the payer back. No dependencies.

```ts
import { newInvoiceId } from 'secret-pay';
import { checkout, readReturn } from 'secret-pay/checkout';

const invoice = {
	chain: 'secret-4',
	address: 'secret16dyfc744j0lrhae0xpfjxl5cnx2hu80h0p0rad', // your address
	asset: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek', // sSCRT
	amount: '12.5',
	id: newInvoiceId(), // keep it with the order: it is the memo you match on
	label: 'Corner Cafe',
	exp: Math.floor(Date.now() / 1000) + 30 * 60,
};

const c = checkout(invoice, {
	returnUrl: 'https://shop.example/order/42', // the wallet sends the payer back here
	fallbackOrigin: 'https://dashboard.nieuportlabs.cz', // a web page for the request if no wallet is installed
});
payButton.onclick = () => (location.href = c.url); // from a click: opens the wallet
qr.textContent = c.uri; // on a computer: show c.uri as a QR code for a phone

// on the return page
const r = readReturn(); // { status: 'paid', tx, id } | { status: 'cancelled', id } | null
```

On Android, `c.url` is an `intent://` link: the wallet (DarkShell shows a payment sheet over the browser) opens if one is installed, otherwise the fallback page. Elsewhere it is a `secret:` URI.

**`readReturn()` is not proof of payment** — anyone can open your return URL with `secret_pay=paid`. Check the payment where your viewing key is safe:

```ts
import { verifyPayment } from 'secret-pay/verify';
import { SecretNetworkClient } from 'secretjs'; // optional peer dependency

const client = new SecretNetworkClient({ url: 'https://lcd.example', chainId: 'secret-4' });
const { status } = await verifyPayment(invoice, client, { viewingKey: process.env.VIEWING_KEY! });
// 'paid' | 'underpaid' | 'late' | 'no_match'
```

Never put a viewing key in a public page: it shows everything the address ever received. Without a server, open the invoice in your own wallet (DarkShell lists issued invoices and marks them paid).

A runnable page: [`examples/checkout.html`](./examples/checkout.html).

## Android apps

Start DarkShell for a result with the request as data:

```kotlin
val pay = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
    val status = r.data?.getStringExtra("status") // "paid" | "cancelled"
    val tx = r.data?.getStringExtra("tx")
}
pay.launch(Intent("cash.darkshell.wallet.action.PAY", Uri.parse("secret:" + encodePaymentUri(invoice))))
```

The same rule applies: confirm the payment by its memo before you deliver.

## Develop

```bash
npm test
npm run build
```

## License

MIT

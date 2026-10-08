# Secret Payment URI — Specification v1

Status: draft 1 · License: MIT

One URI format for everything a Secret Network wallet needs to ask for money:

- a **receiving address** that says which asset it accepts, and
- an **invoice** with an amount, a memo the payer must attach, an expiry, and a way for the recipient to recognise the payment.

It is a superset of the links produced by [Secret_Dashboard](https://github.com/Nieuport-Labs/Secret_Dashboard) (`secret:<addr>?asset=…&amount=…` and `/pay/<addr>?…`), so those links stay valid. Its shape follows [BIP-21](https://github.com/bitcoin/bips/blob/master/bip-0021.mediawiki), including the `req-` rule.

The key words MUST, SHOULD and MAY are used as in RFC 2119.

---

## 1. Forms

The same request can be written in three interchangeable forms.

| Form | Example | Use |
|---|---|---|
| URI | `secret:secret16dyf…0rad?asset=secret1k0jn…fzek&amount=12.5` | QR codes, deep links |
| Web link | `https://<host>/pay/secret16dyf…0rad?asset=…&amount=12.5` | Sharing in chat/e-mail; opens a web page when no wallet handles it |
| Short form | `secret16dyf…0rad:sSCRT` | Human text, copy & paste of a receiving address |

- The **URI** is `secret:` + address + optional `?` + query. The scheme is case-insensitive. Readers SHOULD tolerate `secret://` and `web+secret:`; writers MUST emit `secret:`.
- The **web link** is any `http(s)` URL whose path ends in `/pay/<address>`, followed by the same query as the URI. The host is the publisher's choice.
- The **short form** is `<address>:<asset>` and carries only the address and the required asset. Writers SHOULD use the asset's registered symbol (`sSCRT`); readers resolve it through the registry (§3). Anything more (amount, memo…) needs the URI.
- A **bare address** is a valid request with no parameters.

A QR code SHOULD contain the URI. A "Share" action SHOULD produce the web link.

## 2. Parameters

| Key | Value | Meaning |
|---|---|---|
| `asset` | asset id or alias (§3) | The asset the **recipient wants to receive**. A payer's wallet MAY convert from whatever the payer holds, but MUST deliver this asset. Without `asset`, the recipient did not restrict the asset and the payer's wallet chooses; it SHOULD prefer the private (SNIP-20) form of the native token. |
| `amount` | decimal, whole units | E.g. `12.5`. No sign, no exponent, no thousands separators, at most the asset's decimals. Zero is invalid. Without `asset`, the amount is in the native token. |
| `memo` | UTF-8 text, ≤ 256 bytes | The exact memo the payer MUST attach to the transfer. |
| `id` | UTF-8 text, ≤ 256 bytes | Invoice reference. If `memo` is absent, the payer MUST use `id` as the memo. |
| `exp` | integer, unix seconds | The request expires at this time. Wallets MUST refuse to pay an expired request. |
| `label` | text | Recipient's display name. |
| `message` | text | Note shown to the payer. Not sent on chain. |
| `chain` | chain id | Default `secret-4`. `pulsar-3` for testnet. Wallets MUST refuse a request for a chain they are not connected to. |

Rules:

1. Values are percent-encoded (RFC 3986). Readers MUST also accept `+` as a space. Writers SHOULD emit `%20`.
2. A key MUST NOT appear twice; readers MUST reject duplicates.
3. Keys beginning with `req-` are **required extensions**. A reader that does not understand a `req-` key MUST reject the whole request. v1 defines no `req-` keys.
4. Other unknown keys MUST be ignored (and MAY be preserved).
5. Writers SHOULD emit keys in the order of the table above, and SHOULD omit `chain` when it is `secret-4`.
6. The address MUST be a checksum-valid bech32 address with the `secret` prefix (20-byte account or 32-byte contract). A valid bech32 address with another prefix is a different chain and MUST be rejected with a clear message.

## 3. Assets

The canonical asset id is always the chain's own name for it:

| Kind | Id | Transfer used |
|---|---|---|
| Native | `uscrt` | bank `MsgSend` |
| IBC voucher | `ibc/<64 hex>` | bank `MsgSend` |
| SNIP-20 | `secret1…` (contract address) | SNIP-20 `transfer` (private) |

Writers MUST emit the canonical id in URIs and web links. Readers MUST accept the canonical id and SHOULD accept these registered aliases (case-insensitive):

| Chain | Alias / symbol | Canonical id | Decimals |
|---|---|---|---|
| secret-4 | `scrt` / SCRT | `uscrt` | 6 |
| secret-4 | `sscrt` / sSCRT | `secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek` | 6 |
| pulsar-3 | `scrt` / SCRT | `uscrt` | 6 |

An unregistered SNIP-20 contract or IBC id is valid; the wallet looks up its decimals itself (`token_info`, denom traces). An unregistered bare word is invalid (most likely a mistyped symbol).

## 4. Receiving addresses

A wallet that only wants to receive one asset publishes

```
secret:<address>?asset=<canonical id>
```

and shows the short form `<address>:<SYMBOL>` as text. A payer's wallet that reads such a request MUST send that asset, or convert into it, and MUST NOT silently send something else.

## 5. Invoices

An invoice is a request with `amount` and either `memo` or `id`. It SHOULD carry `exp`.

```
secret:secret16dyfc744j0lrhae0xpfjxl5cnx2hu80h0p0rad
  ?asset=secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek
  &amount=12.5
  &id=INV-7Q2M9K4D
  &exp=1893456000
  &label=Corner%20Cafe
  &message=Table%204
```

(Line breaks for readability only.)

`id` SHOULD be unguessable enough that two open invoices of the same recipient never collide; the reference implementation uses `INV-` + 8 Crockford base32 characters (40 random bits).

Nothing is stored anywhere: **the invoice is its link.** The recipient's wallet keeps its own list of open invoices locally.

### Paying

The payer's wallet:

1. parses and validates the request; refuses if expired or for another chain;
2. shows label, amount, asset, message and the recipient address;
3. sends exactly the requested asset to `address`, for at least `amount`, with memo = `memo` ?? `id`:
   - **SNIP-20**: `{"transfer":{"recipient":…,"amount":…,"memo":…}}`. The memo is encrypted and only visible to sender and recipient.
   - **Native / IBC**: bank `MsgSend` with the memo as the **transaction memo**. This memo is public; wallets SHOULD warn when a memo is used with a public asset.

## 6. Recognising a payment

The recipient matches its received transfers against the request:

- recipient = `address`, asset = `asset`;
- transfer memo = `memo` ?? `id` (exact, case-sensitive);
- sum of matching transfers ≥ `amount` (partial payments with the same memo add up);
- block time ≤ `exp`, when `exp` is set.

Result: `paid`, `underpaid`, `late` or `no_match`.

For SNIP-20 the transfers come from the token's `transaction_history` (or `transfer_history`) query, authorised with a SNIP-24 query permit or a viewing key. For bank assets they come from a tx search on `transfer.recipient` and the tx memo.

## 7. Security notes

- Always show the full recipient address and amount before signing; never trust `label` alone.
- A web link host can change its page but not the request itself: wallets MUST parse the link's path and query, not the page content.
- `message` and `label` are untrusted text; render them as plain text.
- An invoice can be paid more than once. Recipients SHOULD treat payments beyond the first settlement as overpayments.

## 8. Reference implementation

The `secret-pay` package (this repository): `parsePayment`, `encodePaymentUri`, `encodePaymentLink`, `formatShort`, `paymentMemo`, `matchPayment`, `findSettlement`, `toBaseUnits`, `fromBaseUnits`. Test vectors: `test/vectors.json`.

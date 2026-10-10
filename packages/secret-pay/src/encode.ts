import { DEFAULT_CHAIN, findAsset } from './assets.js';
import type { PaymentRequest } from './types.js';

export const SCHEME = 'secret';

/** Parameter order used by the encoder; keeps output stable for tests and diffs. */
const ORDER = ['asset', 'amount', 'memo', 'id', 'exp', 'label', 'message', 'return', 'chain'] as const;

function query(req: PaymentRequest): string {
	const pairs: [string, string][] = [];
	for (const key of ORDER) {
		const value = key === 'chain' ? (req.chain !== DEFAULT_CHAIN ? req.chain : undefined) : req[key];
		if (value !== undefined && value !== '') pairs.push([key, String(value)]);
	}
	for (const [k, v] of Object.entries(req.extra ?? {})) pairs.push([k, v]);
	return pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
}

/**
 * `<address>?asset=…&amount=…` — what goes into a QR code and a shared text.
 * No `secret:` scheme: the bech32 prefix already says which chain it is.
 * (Readers still accept `secret:` URIs.)
 */
export function encodePaymentUri(req: PaymentRequest): string {
	const q = query(req);
	return `${req.address}${q ? `?${q}` : ''}`;
}

/** `https://host/pay/<address>?…` — the shareable web link. */
export function encodePaymentLink(origin: string, req: PaymentRequest): string {
	const q = query(req);
	return `${origin.replace(/\/+$/, '')}/pay/${req.address}${q ? `?${q}` : ''}`;
}

/**
 * Short human form `<address>:<SYMBOL>`, for text and copy/paste. Carries the
 * address and required asset only; anything else needs the full URI.
 */
export function formatShort(req: Pick<PaymentRequest, 'address' | 'asset' | 'chain'>): string {
	if (!req.asset) return req.address;
	const info = findAsset(req.chain ?? DEFAULT_CHAIN, req.asset);
	return `${req.address}:${info ? info.symbol : req.asset}`;
}

/** The memo a payer must attach for this request: `memo`, else `id`, else none. */
export function paymentMemo(req: Pick<PaymentRequest, 'memo' | 'id'>): string | undefined {
	return req.memo ?? req.id;
}

const ID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32

/** Random invoice reference, e.g. `INV-7Q2M9K4D` (40 bits of entropy). */
export function newInvoiceId(prefix = 'INV'): string {
	const bytes = new Uint8Array(8);
	globalThis.crypto.getRandomValues(bytes);
	let out = '';
	for (const b of bytes) out += ID_ALPHABET[b & 31];
	return `${prefix}-${out}`;
}

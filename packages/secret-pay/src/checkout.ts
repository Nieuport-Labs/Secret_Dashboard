// Checkout from a web page: open the payer's Secret wallet with a request and
// get the payer back afterwards. No dependencies; runs in the browser.
//
//   const { url } = checkout(invoice, { returnUrl: location.href });
//   button.onclick = () => (location.href = url);
//   …
//   readReturn()  // → { status: 'paid', tx, id } after the wallet sends the payer back

import { encodePaymentLink, encodePaymentUri } from './encode.js';
import { isReturnUrl } from './parse.js';
import type { PaymentRequest } from './types.js';

export { readReturn, returnUrlFor, type ReturnResult, type ReturnStatus } from './return.js';

export interface CheckoutOptions {
	/** where the wallet sends the payer back (https, or http on localhost) */
	returnUrl?: string;
	/**
	 * Origin of a web page for the request (`https://host` serving `/pay/<address>`).
	 * On Android it opens when no wallet is installed; it is also the link to share.
	 */
	fallbackOrigin?: string;
	/** defaults to navigator.userAgent */
	userAgent?: string;
}

export interface Checkout {
	/** opens the wallet; navigate to it from a user's click */
	url: string;
	/** the request as a URI, for a QR code a phone can scan (desktop checkout) */
	uri: string;
	/** web link for the request, when `fallbackOrigin` is set */
	link?: string;
}

/** Builds the URL that opens the payer's wallet, the URI for a QR code, and the web link. */
export function checkout(req: PaymentRequest, opts: CheckoutOptions = {}): Checkout {
	if (opts.returnUrl !== undefined && !isReturnUrl(opts.returnUrl)) throw new Error('returnUrl must be https (or http on localhost)');
	const r: PaymentRequest = opts.returnUrl ? { ...req, return: opts.returnUrl } : req;
	const uri = encodePaymentUri(r);
	const link = opts.fallbackOrigin ? encodePaymentLink(opts.fallbackOrigin, r) : undefined;
	const ua = opts.userAgent ?? globalThis.navigator?.userAgent ?? '';
	// Chrome on Android opens intent:// URLs and, when nothing handles them,
	// goes to browser_fallback_url instead of an error page
	const url = /Android/i.test(ua)
		? `intent://${uri}#Intent;scheme=secret;action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;${link ? `S.browser_fallback_url=${encodeURIComponent(link)};` : ''}end`
		: `secret:${uri}`;
	return { url, uri, ...(link ? { link } : {}) };
}

/** Opens the wallet right away. Call it from a click handler. */
export function startCheckout(req: PaymentRequest, opts: CheckoutOptions = {}): Checkout {
	const c = checkout(req, opts);
	globalThis.location.href = c.url;
	return c;
}

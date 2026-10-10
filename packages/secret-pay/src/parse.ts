import { normalizeAmount } from './amount.js';
import { DEFAULT_CHAIN, assetKindOf, findAsset } from './assets.js';
import { isBech32Address } from './bech32.js';
import type { ParseErrorCode, ParseResult, PaymentRequest } from './types.js';

export const ADDRESS_PREFIX = 'secret';
export const MAX_MEMO_BYTES = 256;

const KNOWN = new Set(['asset', 'amount', 'memo', 'id', 'exp', 'label', 'message', 'return', 'chain']);

/** Parameters understood by this version that may also appear with a `req-` prefix. */
const KNOWN_REQUIRED = new Set<string>();

type Fail = { ok: false; error: ParseErrorCode; detail?: string };
const fail = (error: ParseErrorCode, detail?: string): Fail => ({ ok: false, error, detail });

/**
 * Parses anything a user might paste or scan: `<addr>?…`, a `secret:` URI, a `…/pay/<addr>`
 * web link, the short form `<addr>:<SYMBOL>`, or a bare address.
 */
export function parsePayment(input: string): ParseResult {
	const raw = input.trim();
	if (!raw) return fail('empty');

	// secret: URI (scheme is case-insensitive; tolerate `secret://`)
	const uri = /^(?:web\+)?secret:(?:\/\/)?([^?#]*)(?:\?([^#]*))?/i.exec(raw);
	if (uri) return build(decodeURIComponent(uri[1]!), uri[2] ?? '', 'uri');

	// web link: https://host/…/pay/<address>?…
	if (/^https?:\/\//i.test(raw)) {
		let url: URL;
		try {
			url = new URL(raw);
		} catch {
			return fail('unrecognized');
		}
		const m = /\/pay\/([^/]+)\/?$/.exec(url.pathname);
		if (!m) return fail('unrecognized');
		return build(decodeURIComponent(m[1]!), url.search.slice(1), 'link');
	}

	// short form: <address>:<asset>
	const short = /^([a-z0-9]+1[02-9ac-hj-np-z]+):([^\s:?]+)$/i.exec(raw);
	if (short) return build(short[1]!, `asset=${encodeURIComponent(short[2]!)}`, 'short');

	// address with parameters: <address>?asset=…&amount=…
	const withQuery = /^([a-z0-9]+1[02-9ac-hj-np-z]+)\?([^#]*)$/i.exec(raw);
	if (withQuery) return build(withQuery[1]!, withQuery[2]!, 'uri');

	// bare address
	if (/^[a-z0-9]+1[02-9ac-hj-np-z]+$/i.test(raw)) return build(raw, '', 'address');

	return fail('unrecognized');
}

function build(address: string, search: string, source: 'uri' | 'link' | 'short' | 'address'): ParseResult {
	const params = new Map<string, string>();
	for (const [k, v] of new URLSearchParams(search)) {
		if (params.has(k)) return fail('duplicate_param', k);
		params.set(k, v);
	}

	// BIP-21 rule: an unknown `req-` parameter makes the whole request invalid.
	const extra: Record<string, string> = {};
	for (const [k, v] of params) {
		if (k.startsWith('req-')) {
			if (!KNOWN_REQUIRED.has(k.slice(4))) return fail('unsupported_required_param', k);
		} else if (!KNOWN.has(k)) {
			extra[k] = v;
		}
	}

	const chain = params.get('chain') || DEFAULT_CHAIN;
	const addr = address.toLowerCase();
	if (!isBech32Address(addr, ADDRESS_PREFIX)) {
		return fail(isBech32Address(addr, addr.slice(0, addr.lastIndexOf('1'))) ? 'wrong_chain' : 'bad_address', address);
	}

	const req: PaymentRequest = { chain, address: addr };

	let decimals: number | undefined;
	const assetParam = params.get('asset');
	if (assetParam !== undefined) {
		const info = findAsset(chain, assetParam);
		if (info) {
			req.asset = info.id;
			decimals = info.decimals;
		} else {
			const kind = assetKindOf(assetParam);
			// unregistered SNIP-20 and IBC ids are fine (the wallet looks them up);
			// an unregistered bare word is most likely a typo'd symbol
			if (kind === 'snip20') {
				if (!isBech32Address(assetParam, ADDRESS_PREFIX)) return fail('bad_asset', assetParam);
				req.asset = assetParam;
			} else if (kind === 'ibc') {
				req.asset = assetParam;
			} else {
				return fail(kind ? 'unknown_asset' : 'bad_asset', assetParam);
			}
		}
	}

	const amountParam = params.get('amount');
	if (amountParam !== undefined) {
		const norm = normalizeAmount(amountParam);
		if (norm === null) return fail('bad_amount', amountParam);
		if (!req.asset) {
			// an amount without an asset is in the chain's native token
			const native = findAsset(chain, 'uscrt');
			req.asset = 'uscrt';
			decimals = native?.decimals ?? 6;
		}
		const frac = norm.split('.')[1] ?? '';
		if (decimals !== undefined && frac.length > decimals) return fail('too_many_decimals', amountParam);
		req.amount = norm;
	}

	const memo = params.get('memo');
	if (memo !== undefined && memo !== '') {
		if (new TextEncoder().encode(memo).length > MAX_MEMO_BYTES) return fail('memo_too_long');
		req.memo = memo;
	}

	const id = params.get('id');
	if (id !== undefined && id !== '') {
		if (new TextEncoder().encode(id).length > MAX_MEMO_BYTES) return fail('memo_too_long', 'id');
		req.id = id;
	}

	const exp = params.get('exp');
	if (exp !== undefined) {
		if (!/^[1-9][0-9]{0,11}$/.test(exp)) return fail('bad_exp', exp);
		req.exp = Number(exp);
	}

	const label = params.get('label');
	if (label) req.label = label;
	const message = params.get('message');
	if (message) req.message = message;
	const ret = params.get('return');
	if (ret !== undefined && ret !== '') {
		if (!isReturnUrl(ret)) return fail('bad_return', ret);
		req.return = ret;
	}
	if (Object.keys(extra).length) req.extra = extra;

	return { ok: true, request: req, source };
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** A `return` URL must be https (or http on the developer's own machine), without credentials. */
export function isReturnUrl(value: string): boolean {
	let u: URL;
	try {
		u = new URL(value);
	} catch {
		return false;
	}
	if (u.username || u.password) return false;
	return u.protocol === 'https:' || (u.protocol === 'http:' && LOCAL_HOSTS.has(u.hostname));
}

/** True once the request's expiry has passed. `now` is unix seconds. */
export function isExpired(req: Pick<PaymentRequest, 'exp'>, now = Math.floor(Date.now() / 1000)): boolean {
	return req.exp !== undefined && now >= req.exp;
}

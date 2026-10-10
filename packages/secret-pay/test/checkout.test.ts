import { describe, expect, it } from 'vitest';
import { checkout, readReturn, returnUrlFor } from '../src/checkout.js';
import { parsePayment, type PaymentRequest } from '../src/index.js';
import { receivedSnip20, verifyPayment, type ContractQuerier } from '../src/verify.js';

const ADDR = 'secret16dyfc744j0lrhae0xpfjxl5cnx2hu80h0p0rad';
const SSCRT = 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek';
const inv: PaymentRequest = { chain: 'secret-4', address: ADDR, asset: SSCRT, amount: '2.5', id: 'INV-7Q2M9K4D' };
const TX = 'A'.repeat(64);

describe('checkout', () => {
	it('opens a secret: URI outside Android', () => {
		const c = checkout(inv, { returnUrl: 'https://shop.example/done', userAgent: 'Mozilla/5.0 (Windows NT 10.0)' });
		expect(c.url).toBe(`secret:${c.uri}`);
		const r = parsePayment(c.url);
		expect(r.ok && r.request.return).toBe('https://shop.example/done');
	});

	it('uses an intent with a web fallback on Android', () => {
		const c = checkout(inv, { returnUrl: 'https://shop.example/done', fallbackOrigin: 'https://pay.example', userAgent: 'Mozilla/5.0 (Linux; Android 15)' });
		expect(c.url.startsWith(`intent://${c.uri}#Intent;scheme=secret;`)).toBe(true);
		expect(c.url).toContain(`S.browser_fallback_url=${encodeURIComponent(c.link!)};end`);
		// what Android hands the wallet: secret://<uri>
		const r = parsePayment(`secret://${c.uri}`);
		expect(r.ok && r.request.amount).toBe('2.5');
	});

	it('refuses an unsafe return URL', () => {
		expect(() => checkout(inv, { returnUrl: 'http://shop.example/' })).toThrow();
		expect(() => checkout(inv, { returnUrl: 'http://localhost:5173/' })).not.toThrow();
	});
});

describe('return', () => {
	const req = { ...inv, return: 'https://shop.example/done?order=42' };
	it('round-trips paid and cancelled', () => {
		const paid = returnUrlFor(req, { status: 'paid', tx: TX })!;
		expect(paid).toBe(`https://shop.example/done?order=42&secret_pay=paid&tx=${TX}&id=INV-7Q2M9K4D`);
		expect(readReturn(paid)).toEqual({ status: 'paid', tx: TX, id: 'INV-7Q2M9K4D' });
		expect(readReturn(returnUrlFor(req, { status: 'cancelled' })!)).toEqual({ status: 'cancelled', id: 'INV-7Q2M9K4D' });
	});
	it('ignores pages without an outcome and bad hashes', () => {
		expect(returnUrlFor(inv, { status: 'paid' })).toBeNull();
		expect(readReturn('https://shop.example/done')).toBeNull();
		expect(readReturn('https://shop.example/?secret_pay=paid&tx=<script>')).toEqual({ status: 'paid' });
	});
});

describe('verify', () => {
	const tx = (id: number, from: string, recipient: string, amount: string, memo: string | null) => ({
		id,
		action: { transfer: { from, sender: from, recipient } },
		coins: { denom: 'SSCRT', amount },
		memo,
		block_time: 1_800_000_000,
	});
	const client = (txs: object[], seen: object[] = []): ContractQuerier => ({
		query: {
			compute: {
				async queryContract(req) {
					seen.push(req);
					return { transaction_history: { txs, total: txs.length } };
				},
			},
		},
	});

	it('reads received transfers with a viewing key', async () => {
		const seen: { query: object }[] = [];
		const r = await receivedSnip20(client([tx(2, 'secret1payer', ADDR, '2500000', 'INV-7Q2M9K4D'), tx(1, ADDR, 'secret1other', '1', null)], seen), { address: SSCRT }, ADDR, { viewingKey: 'vk' });
		expect(r).toHaveLength(1);
		expect(r[0]!.sender).toBe('secret1payer');
		expect(seen[0]!.query).toEqual({ transaction_history: { address: ADDR, key: 'vk', page_size: 50, page: 0 } });
	});

	it('settles an invoice', async () => {
		expect((await verifyPayment(inv, client([tx(2, 'secret1payer', ADDR, '2500000', 'INV-7Q2M9K4D')]), { permit: {} })).status).toBe('paid');
		expect((await verifyPayment(inv, client([tx(2, 'secret1payer', ADDR, '2000000', 'INV-7Q2M9K4D')]), { permit: {} })).status).toBe('underpaid');
		expect((await verifyPayment(inv, client([]), { permit: {} })).status).toBe('no_match');
	});
});

import { describe, expect, it } from 'vitest';
import {
	encodePaymentLink,
	encodePaymentUri,
	findSettlement,
	formatShort,
	fromBaseUnits,
	isBech32Address,
	isExpired,
	matchPayment,
	newInvoiceId,
	parsePayment,
	paymentMemo,
	toBaseUnits,
	type PaymentRequest,
} from '../src/index.js';
import vectors from './vectors.json' with { type: 'json' };

const ADDR = 'secret16dyfc744j0lrhae0xpfjxl5cnx2hu80h0p0rad';
const SSCRT = 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek';

describe('bech32', () => {
	it('accepts real secret addresses', () => {
		expect(isBech32Address(ADDR, 'secret')).toBe(true);
		expect(isBech32Address(SSCRT, 'secret')).toBe(true);
	});
	it('rejects a broken checksum and wrong prefix', () => {
		expect(isBech32Address(ADDR.slice(0, -1) + 'q', 'secret')).toBe(false);
		expect(isBech32Address(ADDR, 'osmo')).toBe(false);
	});
});

describe('amounts', () => {
	it('round-trips', () => {
		expect(toBaseUnits('12.5', 6)).toBe(12_500_000n);
		expect(toBaseUnits('0.000001', 6)).toBe(1n);
		expect(fromBaseUnits(12_500_000n, 6)).toBe('12.5');
		expect(fromBaseUnits('1000000', 6)).toBe('1');
	});
	it('refuses excess precision', () => {
		expect(() => toBaseUnits('0.0000001', 6)).toThrow();
	});
});

describe('vectors', () => {
	for (const v of vectors.valid) {
		it(`parses ${v.name}`, () => {
			const r = parsePayment(v.input);
			expect(r.ok, JSON.stringify(r)).toBe(true);
			if (!r.ok) return;
			expect(r.request).toEqual(v.request);
			if (v.canonical) expect(encodePaymentUri(r.request)).toBe(v.canonical);
		});
	}
	for (const v of vectors.invalid) {
		it(`rejects ${v.name}`, () => {
			const r = parsePayment(v.input);
			expect(r.ok).toBe(false);
			if (!r.ok) expect(r.error).toBe(v.error);
		});
	}
});

describe('encode', () => {
	const inv: PaymentRequest = {
		chain: 'secret-4',
		address: ADDR,
		asset: SSCRT,
		amount: '12.5',
		id: 'INV-7Q2M9K4D',
		exp: 1893456000,
		message: 'Coffee & cake',
	};
	it('round-trips URI and link', () => {
		const uri = encodePaymentUri(inv);
		expect(uri).toBe(
			`secret:${ADDR}?asset=${SSCRT}&amount=12.5&id=INV-7Q2M9K4D&exp=1893456000&message=Coffee%20%26%20cake`,
		);
		const back = parsePayment(uri);
		expect(back.ok && back.request).toEqual(inv);
		const link = encodePaymentLink('https://pay.example/', inv);
		expect(link.startsWith(`https://pay.example/pay/${ADDR}?asset=`)).toBe(true);
		const fromLink = parsePayment(link);
		expect(fromLink.ok && fromLink.request).toEqual(inv);
	});
	it('short form', () => {
		expect(formatShort({ address: ADDR, asset: SSCRT, chain: 'secret-4' })).toBe(`${ADDR}:sSCRT`);
		const r = parsePayment(`${ADDR}:sSCRT`);
		expect(r.ok && r.request.asset).toBe(SSCRT);
	});
	it('memo falls back to id', () => {
		expect(paymentMemo({ id: 'X' })).toBe('X');
		expect(paymentMemo({ id: 'X', memo: 'Y' })).toBe('Y');
	});
	it('generates ids', () => {
		expect(newInvoiceId()).toMatch(/^INV-[0-9A-Z]{8}$/);
	});
	it('expiry', () => {
		expect(isExpired({ exp: 100 }, 99)).toBe(false);
		expect(isExpired({ exp: 100 }, 100)).toBe(true);
		expect(isExpired({}, 1e12)).toBe(false);
	});
});

describe('matching', () => {
	const req: PaymentRequest = { chain: 'secret-4', address: ADDR, asset: SSCRT, amount: '10', id: 'INV-A', exp: 1000 };
	const base = { to: ADDR, asset: SSCRT, memo: 'INV-A', time: 900 };
	it('paid / underpaid / late / no_match', () => {
		expect(matchPayment(req, { ...base, amount: 10_000_000n })).toBe('paid');
		expect(matchPayment(req, { ...base, amount: 9_999_999n })).toBe('underpaid');
		expect(matchPayment(req, { ...base, amount: 10_000_000n, time: 1001 })).toBe('late');
		expect(matchPayment(req, { ...base, amount: 10_000_000n, memo: 'other' })).toBe('no_match');
	});
	it('sums partial payments', () => {
		const s = findSettlement(req, [
			{ ...base, amount: 4_000_000n },
			{ ...base, amount: 6_000_000n },
			{ ...base, amount: 50_000_000n, memo: 'unrelated' },
		]);
		expect(s.status).toBe('paid');
		expect(s.transfers).toHaveLength(2);
	});
});

// Sending the payer back to the payee (SPEC §6a). The wallet appends the
// outcome to the request's `return` URL; the payee reads it with readReturn().
// The outcome is a hint, not proof: the payee confirms the payment itself.

import type { PaymentRequest } from './types.js';

export type ReturnStatus = 'paid' | 'cancelled';

export interface ReturnResult {
	status: ReturnStatus;
	/** the payment's transaction hash, when paid */
	tx?: string;
	/** the request's `id`, when it had one */
	id?: string;
}

/** The `return` URL with the outcome appended (`secret_pay`, `tx`, `id`). */
export function returnUrlFor(req: Pick<PaymentRequest, 'return' | 'id'>, result: Omit<ReturnResult, 'id'>): string | null {
	if (!req.return) return null;
	const u = new URL(req.return);
	u.searchParams.set('secret_pay', result.status);
	if (result.tx) u.searchParams.set('tx', result.tx);
	if (req.id) u.searchParams.set('id', req.id);
	return u.toString();
}

/** Reads the outcome the wallet appended to the return URL; null when there is none. */
export function readReturn(url: string = globalThis.location?.href ?? ''): ReturnResult | null {
	let u: URL;
	try {
		u = new URL(url);
	} catch {
		return null;
	}
	const status = u.searchParams.get('secret_pay');
	if (status !== 'paid' && status !== 'cancelled') return null;
	const tx = u.searchParams.get('tx') ?? undefined;
	const id = u.searchParams.get('id') ?? undefined;
	return { status, ...(tx && /^[0-9A-Fa-f]{64}$/.test(tx) ? { tx } : {}), ...(id ? { id } : {}) };
}

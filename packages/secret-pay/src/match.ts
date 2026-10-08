import { toBaseUnits } from './amount.js';
import { findAsset } from './assets.js';
import { paymentMemo } from './encode.js';
import type { PaymentRequest } from './types.js';

/** A received transfer as the recipient sees it in its (private) history. */
export interface ReceivedTransfer {
	/** recipient address */
	to: string;
	/** canonical asset id */
	asset: string;
	/** base units */
	amount: bigint | string;
	memo?: string | null;
	/** unix seconds of the block, when known */
	time?: number;
	sender?: string;
	txHash?: string;
}

export type MatchStatus = 'paid' | 'underpaid' | 'late' | 'no_match';

/**
 * Checks one transfer against a request (SPEC §6). `decimals` is required for
 * assets that are not in the registry.
 */
export function matchPayment(req: PaymentRequest, t: ReceivedTransfer, decimals?: number): MatchStatus {
	const memo = paymentMemo(req);
	if (t.to.toLowerCase() !== req.address) return 'no_match';
	if (req.asset && t.asset !== req.asset) return 'no_match';
	if (memo !== undefined && (t.memo ?? '') !== memo) return 'no_match';
	if (memo === undefined && req.amount === undefined) return 'no_match';

	if (req.amount !== undefined) {
		const dec = decimals ?? findAsset(req.chain, req.asset ?? 'uscrt')?.decimals;
		if (dec === undefined) throw new Error(`unknown decimals for ${req.asset}`);
		if (BigInt(t.amount) < toBaseUnits(req.amount, dec)) return 'underpaid';
	}
	if (req.exp !== undefined && t.time !== undefined && t.time > req.exp) return 'late';
	return 'paid';
}

/**
 * Finds the best settlement for a request among received transfers. Several
 * partial payments with the same memo are summed.
 */
export function findSettlement(
	req: PaymentRequest,
	transfers: ReceivedTransfer[],
	decimals?: number,
): { status: MatchStatus; transfers: ReceivedTransfer[] } {
	const memo = paymentMemo(req);
	const candidates = transfers.filter((t) => {
		const s = matchPayment({ ...req, amount: undefined, exp: undefined }, t, decimals);
		return s === 'paid';
	});
	if (!candidates.length) return { status: 'no_match', transfers: [] };
	if (memo === undefined || req.amount === undefined) {
		const single = candidates.map((t) => ({ t, s: matchPayment(req, t, decimals) }));
		const hit = single.find((x) => x.s === 'paid') ?? single[0]!;
		return { status: hit.s, transfers: [hit.t] };
	}
	const dec = decimals ?? findAsset(req.chain, req.asset ?? 'uscrt')?.decimals ?? 6;
	const onTime = candidates.filter((t) => req.exp === undefined || t.time === undefined || t.time <= req.exp);
	const total = onTime.reduce((s, t) => s + BigInt(t.amount), 0n);
	if (total >= toBaseUnits(req.amount, dec)) return { status: 'paid', transfers: onTime };
	if (onTime.length < candidates.length) return { status: 'late', transfers: candidates };
	return { status: 'underpaid', transfers: onTime };
}

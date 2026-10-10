// Payee side: was this request paid? Reads the payee's received SNIP-20
// transfers (SPEC §6) with a viewing key or a query permit, then matches them.
// Run it where the key is safe (your backend or your own wallet), never in a
// public page: a viewing key reveals the whole history of the address.
//
// Works with a secretjs SecretNetworkClient (any client with the same
// `query.compute.queryContract` shape).

import { findSettlement, type MatchStatus, type ReceivedTransfer } from './match.js';
import type { PaymentRequest } from './types.js';

export interface ContractQuerier {
	query: { compute: { queryContract(req: { contract_address: string; code_hash?: string; query: object }): Promise<unknown> } };
}

export type Snip20Auth = { viewingKey: string } | { permit: object };

interface RichTx {
	id: number | string;
	action: Record<string, { from?: string; recipient?: string }>;
	coins: { denom: string; amount: string };
	memo?: string | null;
	block_time?: number;
}

function historyQuery(address: string, auth: Snip20Auth, pageSize: number, page: number): object {
	const q = { page_size: pageSize, page };
	return 'viewingKey' in auth
		? { transaction_history: { address, key: auth.viewingKey, ...q } }
		: { with_permit: { permit: auth.permit, query: { transaction_history: q } } };
}

/** Transfers `address` received in the SNIP-20 `token`, newest first. */
export async function receivedSnip20(
	client: ContractQuerier,
	token: { address: string; codeHash?: string },
	address: string,
	auth: Snip20Auth,
	{ pageSize = 50, pages = 1 } = {},
): Promise<ReceivedTransfer[]> {
	const out: ReceivedTransfer[] = [];
	for (let page = 0; page < pages; page++) {
		const reply = await client.query.compute.queryContract({
			contract_address: token.address,
			...(token.codeHash ? { code_hash: token.codeHash } : {}),
			query: historyQuery(address, auth, pageSize, page),
		});
		if (typeof reply === 'string') throw new Error(reply);
		const r = reply as { transaction_history?: { txs: RichTx[] }; generic_err?: { msg: string }; query_error?: { msg: string }; viewing_key_error?: { msg: string } };
		const err = r.generic_err ?? r.query_error ?? r.viewing_key_error;
		if (err) throw new Error(err.msg);
		const txs = r.transaction_history?.txs ?? [];
		for (const t of txs) {
			const [type, data] = Object.entries(t.action)[0] ?? [];
			if (type !== 'transfer' || !data || data.recipient !== address) continue;
			out.push({ to: address, asset: token.address, amount: t.coins.amount, memo: t.memo ?? null, time: t.block_time, sender: data.from });
		}
		if (txs.length < pageSize) break;
	}
	return out;
}

/** Checks a request against what the payee received. The request's `asset` must be a SNIP-20. */
export async function verifyPayment(
	req: PaymentRequest,
	client: ContractQuerier,
	auth: Snip20Auth,
	opts: { codeHash?: string; decimals?: number; pageSize?: number; pages?: number } = {},
): Promise<{ status: MatchStatus; transfers: ReceivedTransfer[] }> {
	if (!req.asset?.startsWith('secret1')) throw new Error('verifyPayment reads SNIP-20 history; for SCRT or IBC assets search the chain for transfers to the address');
	const received = await receivedSnip20(client, { address: req.asset, codeHash: opts.codeHash }, req.address, auth, opts);
	return findSettlement(req, received, opts.decimals);
}

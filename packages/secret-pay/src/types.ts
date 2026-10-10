/**
 * A Secret payment request. With only `address` (and optionally `asset`) it is
 * a receiving address; with an `amount` it is an invoice.
 */
export interface PaymentRequest {
	/** chain id, default `secret-4` */
	chain: string;
	/** recipient bech32 address (`secret1…`) */
	address: string;
	/** canonical asset id the recipient wants to receive (`uscrt`, `ibc/…`, `secret1…`) */
	asset?: string;
	/** amount in whole units of `asset`, normalised decimal string */
	amount?: string;
	/** exact memo the payer must attach to the transfer */
	memo?: string;
	/** invoice reference chosen by the recipient */
	id?: string;
	/** expiry, unix seconds */
	exp?: number;
	/** recipient's display name */
	label?: string;
	/** human-readable note for the payer */
	message?: string;
	/** where the payer's wallet sends the payer back after paying or cancelling (https, or http on localhost) */
	return?: string;
	/** unknown optional parameters, preserved for round-tripping */
	extra?: Record<string, string>;
}

export type ParseErrorCode =
	| 'empty'
	| 'unrecognized'
	| 'bad_address'
	| 'bad_asset'
	| 'unknown_asset'
	| 'bad_amount'
	| 'too_many_decimals'
	| 'bad_exp'
	| 'bad_return'
	| 'memo_too_long'
	| 'duplicate_param'
	| 'unsupported_required_param'
	| 'wrong_chain';

export type ParseResult =
	| { ok: true; request: PaymentRequest; source: 'uri' | 'link' | 'short' | 'address' }
	| { ok: false; error: ParseErrorCode; detail?: string };

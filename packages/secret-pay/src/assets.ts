// Asset registry. The canonical asset id in a URI is always the chain's own
// name for it: a bank denom (`uscrt`, `ibc/<HASH>`) or a SNIP-20 contract
// address (`secret1…`). Symbols are accepted as aliases and are only a
// convenience for humans; they resolve through this registry.

export type AssetKind = 'native' | 'ibc' | 'snip20';

export interface AssetInfo {
	/** canonical id: bank denom or SNIP-20 contract address */
	id: string;
	symbol: string;
	decimals: number;
	kind: AssetKind;
	/** true when balances and transfers are private (SNIP-20) */
	private: boolean;
	/** lower-case aliases accepted in `asset=` and in the short form */
	aliases: string[];
	/** for SNIP-20 wrappers: the bank denom it wraps */
	wraps?: string;
}

export const DEFAULT_CHAIN = 'secret-4';

const REGISTRY: Record<string, AssetInfo[]> = {
	'secret-4': [
		{
			id: 'uscrt',
			symbol: 'SCRT',
			decimals: 6,
			kind: 'native',
			private: false,
			aliases: ['scrt'],
		},
		{
			id: 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek',
			symbol: 'sSCRT',
			decimals: 6,
			kind: 'snip20',
			private: true,
			aliases: ['sscrt'],
			wraps: 'uscrt',
		},
	],
	'pulsar-3': [
		{
			id: 'uscrt',
			symbol: 'SCRT',
			decimals: 6,
			kind: 'native',
			private: false,
			aliases: ['scrt'],
		},
	],
};

const extra: Record<string, AssetInfo[]> = {};

/** Registers additional assets (e.g. other SNIP-20s) for a chain at runtime. */
export function registerAsset(chain: string, asset: AssetInfo): void {
	(extra[chain] ??= []).push(asset);
}

export function assetsFor(chain: string): AssetInfo[] {
	return [...(REGISTRY[chain] ?? []), ...(extra[chain] ?? [])];
}

/** Looks an asset up by canonical id, symbol or alias (case-insensitive for symbols). */
export function findAsset(chain: string, idOrAlias: string): AssetInfo | undefined {
	const list = assetsFor(chain);
	const exact = list.find((a) => a.id === idOrAlias);
	if (exact) return exact;
	const key = idOrAlias.toLowerCase();
	return list.find((a) => a.symbol.toLowerCase() === key || a.aliases.includes(key));
}

/** Kind of an asset id judged by its shape alone (works for unregistered assets). */
export function assetKindOf(id: string): AssetKind | null {
	if (/^ibc\/[0-9A-F]{64}$/.test(id)) return 'ibc';
	if (/^secret1[02-9ac-hj-np-z]{38,58}$/.test(id)) return 'snip20';
	if (/^[a-z][a-z0-9/:._-]{1,127}$/.test(id)) return 'native';
	return null;
}

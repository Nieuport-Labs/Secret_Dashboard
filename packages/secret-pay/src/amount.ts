// Amounts travel in URIs as decimal strings in whole units ("12.5"), never as
// floats. These helpers convert exactly between whole units and base units.

const DECIMAL = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;

/** Normalises a decimal amount string; returns null when it is not a plain positive decimal. */
export function normalizeAmount(input: string): string | null {
	const s = input.trim();
	if (!DECIMAL.test(s)) return null;
	let [int, frac = ''] = s.split('.') as [string, string?];
	frac = frac.replace(/0+$/, '');
	const out = frac ? `${int}.${frac}` : int;
	return /^0(\.0*)?$/.test(out) ? null : out;
}

/** Whole units → base units. Throws when the amount has more decimals than the asset. */
export function toBaseUnits(amount: string, decimals: number): bigint {
	const norm = normalizeAmount(amount);
	if (norm === null) throw new RangeError(`invalid amount: ${amount}`);
	const [int, frac = ''] = norm.split('.') as [string, string?];
	if (frac.length > decimals) throw new RangeError(`amount has more than ${decimals} decimals`);
	return BigInt(int) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0') || '0');
}

/** Base units → whole units, without trailing zeros. */
export function fromBaseUnits(base: bigint | string, decimals: number): string {
	const v = typeof base === 'bigint' ? base : BigInt(base);
	const neg = v < 0n;
	const abs = neg ? -v : v;
	const unit = 10n ** BigInt(decimals);
	const int = abs / unit;
	const frac = (abs % unit).toString().padStart(decimals, '0').replace(/0+$/, '');
	return `${neg ? '-' : ''}${int}${frac ? `.${frac}` : ''}`;
}

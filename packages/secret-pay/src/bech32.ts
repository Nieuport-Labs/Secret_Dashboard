// Minimal bech32 (BIP-173) checksum validation. Cosmos addresses use the
// original bech32 constant, not bech32m.

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const GENERATORS = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values: number[]): number {
	let chk = 1;
	for (const v of values) {
		const top = chk >>> 25;
		chk = ((chk & 0x1ffffff) << 5) ^ v;
		for (let i = 0; i < 5; i++) {
			if ((top >>> i) & 1) chk ^= GENERATORS[i]!;
		}
	}
	return chk;
}

function hrpExpand(hrp: string): number[] {
	const out: number[] = [];
	for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) >>> 5);
	out.push(0);
	for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) & 31);
	return out;
}

export interface Bech32Parts {
	hrp: string;
	/** 5-bit words, checksum stripped */
	words: number[];
}

/** Decodes a bech32 string; returns null when it is not valid bech32. */
export function bech32Decode(input: string): Bech32Parts | null {
	if (input.length < 8 || input.length > 90) return null;
	const lower = input.toLowerCase();
	if (input !== lower && input !== input.toUpperCase()) return null;
	const sep = lower.lastIndexOf('1');
	if (sep < 1 || sep + 7 > lower.length) return null;
	const hrp = lower.slice(0, sep);
	const data: number[] = [];
	for (const ch of lower.slice(sep + 1)) {
		const v = CHARSET.indexOf(ch);
		if (v === -1) return null;
		data.push(v);
	}
	if (polymod([...hrpExpand(hrp), ...data]) !== 1) return null;
	return { hrp, words: data.slice(0, -6) };
}

/** Length in bytes of the decoded payload. */
export function bech32PayloadLength(parts: Bech32Parts): number {
	return Math.floor((parts.words.length * 5) / 8);
}

/** True for a checksum-valid bech32 account or contract address with the given prefix. */
export function isBech32Address(input: string, prefix: string): boolean {
	const parts = bech32Decode(input);
	if (!parts || parts.hrp !== prefix) return false;
	const len = bech32PayloadLength(parts);
	// 20 bytes for accounts, 32 bytes for contracts / module accounts
	return len === 20 || len === 32;
}

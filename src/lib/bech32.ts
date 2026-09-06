/**
 * Bech32 checksum verification, for the one place it matters: the recipient
 * field on a send form.
 *
 * A prefix-and-length check catches a truncated paste and nothing else. Bech32
 * carries a BCH checksum precisely so that a mistyped or corrupted address is
 * rejected rather than accepted as some other valid-looking account, and a
 * transfer to an address nobody holds the key to is unrecoverable — so the
 * checksum is worth the thirty lines.
 *
 * Written out rather than imported: `bech32` is in node_modules only as
 * somebody else's transitive dependency, pinned at 1.x, and depending on a
 * package this project never declared is a break waiting for the next install.
 *
 * BIP-173, restricted to what is needed here — verification, not encoding.
 */

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]

function polymod(values: number[]): number {
  let checksum = 1
  for (const value of values) {
    const top = checksum >>> 25
    checksum = ((checksum & 0x1ffffff) << 5) ^ value
    for (let i = 0; i < 5; i++) {
      if ((top >>> i) & 1) checksum ^= GENERATOR[i]
    }
  }
  return checksum
}

/** The human-readable part contributes its high bits, a separator, then its low bits. */
function expandPrefix(prefix: string): number[] {
  const high: number[] = []
  const low: number[] = []
  for (let i = 0; i < prefix.length; i++) {
    const code = prefix.charCodeAt(i)
    high.push(code >>> 5)
    low.push(code & 31)
  }
  return [...high, 0, ...low]
}

/**
 * @param address the full bech32 string
 * @param prefix the human-readable part it must carry, e.g. `secret`
 */
export function isValidBech32(address: string, prefix: string): boolean {
  // Mixed case is invalid per the spec, and lowercase is what every wallet
  // produces, so an uppercase paste is normalised rather than rejected.
  const lower = address.toLowerCase()
  if (address !== lower && address !== address.toUpperCase()) return false

  // 90 is the spec's limit; a Secret account address is 45.
  if (lower.length < 8 || lower.length > 90) return false
  if (!lower.startsWith(`${prefix}1`)) return false

  const data = lower.slice(prefix.length + 1)
  // Six of those characters are the checksum itself, so anything shorter has no
  // payload at all.
  if (data.length < 6) return false

  const values: number[] = []
  for (const character of data) {
    const value = CHARSET.indexOf(character)
    // `1`, `b`, `i` and `o` are deliberately absent from the charset — they are
    // the characters people confuse when copying by hand.
    if (value === -1) return false
    values.push(value)
  }

  return polymod([...expandPrefix(prefix), ...values]) === 1
}

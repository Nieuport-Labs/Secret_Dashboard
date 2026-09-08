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
 * BIP-173. Encoding is here too, for the one thing that needs it: Cosmos gives
 * an account, its validator and its consensus identity three different prefixes
 * over the same 20 bytes, so `secret1…` and `secretvaloper1…` are the same key
 * spelled twice and converting between them is how the app recognises that the
 * connected wallet operates a validator.
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

/**
 * Regroup a byte stream into `to`-bit words.
 *
 * Bech32 carries 5-bit words while everything it addresses is bytes, so this
 * runs in both directions. Padding is right for 8→5 (the tail of the last byte
 * needs somewhere to go) and wrong for 5→8, where a non-zero remainder means
 * the string was malformed rather than short.
 */
function convertBits(data: readonly number[], from: number, to: number, pad: boolean): number[] | undefined {
  let accumulator = 0
  let bits = 0
  const result: number[] = []
  const max = (1 << to) - 1

  for (const value of data) {
    if (value < 0 || value >> from !== 0) return undefined
    accumulator = (accumulator << from) | value
    bits += from
    while (bits >= to) {
      bits -= to
      result.push((accumulator >> bits) & max)
    }
  }

  if (pad) {
    if (bits > 0) result.push((accumulator << (to - bits)) & max)
  } else if (bits >= from || ((accumulator << (to - bits)) & max) !== 0) {
    return undefined
  }

  return result
}

/** The payload of a bech32 string, with the prefix it was carrying. */
export function decodeBech32(address: string): { prefix: string; bytes: Uint8Array } | undefined {
  const lower = address.toLowerCase()
  if (address !== lower && address !== address.toUpperCase()) return undefined

  // The separator is the *last* `1`, since the prefix may contain one.
  const separator = lower.lastIndexOf('1')
  if (separator < 1 || separator + 7 > lower.length || lower.length > 90) return undefined

  const prefix = lower.slice(0, separator)
  const words: number[] = []
  for (const character of lower.slice(separator + 1)) {
    const value = CHARSET.indexOf(character)
    if (value === -1) return undefined
    words.push(value)
  }

  if (polymod([...expandPrefix(prefix), ...words]) !== 1) return undefined

  const bytes = convertBits(words.slice(0, -6), 5, 8, false)
  return bytes ? { prefix, bytes: Uint8Array.from(bytes) } : undefined
}

export function encodeBech32(prefix: string, bytes: Uint8Array): string {
  const words = convertBits([...bytes], 8, 5, true)
  if (!words) throw new Error('Cannot encode these bytes as bech32')

  // Six zero words stand in for the checksum while it is being computed.
  const checksum = polymod([...expandPrefix(prefix), ...words, 0, 0, 0, 0, 0, 0]) ^ 1
  const tail: number[] = []
  for (let i = 0; i < 6; i++) tail.push((checksum >> (5 * (5 - i))) & 31)

  return `${prefix}1${[...words, ...tail].map((word) => CHARSET[word]).join('')}`
}

/** Re-spell an address under a different prefix, e.g. `secret1…` → `secretvaloper1…`. */
export function reprefix(address: string, prefix: string): string | undefined {
  const decoded = decodeBech32(address)
  return decoded ? encodeBech32(prefix, decoded.bytes) : undefined
}

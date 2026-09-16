/**
 * Making an encrypted message reviewable by people who did not encrypt it.
 *
 * This is the problem no other multisig tool has to solve, and the reason a
 * Secret multisig cannot just be multisig.keplr.app with a different chain id.
 * The body of a `MsgExecuteContract` is encrypted to the enclave, so what a
 * member is asked to sign looks like this:
 *
 *     wasm/MsgExecuteContract  msg: "3q2+78r+…"   (400 bytes of base64)
 *
 * Their wallet shows them that. A hardware wallet shows them that. Nobody can
 * tell a token transfer from a "send everything to me" by looking at it, and
 * "the proposer says it is a transfer" is not a security model — it is the
 * absence of one.
 *
 * ## What this module does about it
 *
 * Every proposal carries its own freshly generated transaction-encryption
 * seed, and that seed travels with the proposal. The proposer encrypts with
 * it; every member rebuilds the same `EncryptionUtils` from it, decrypts the
 * ciphertext themselves, and checks that what comes out is the message the
 * proposal claims — targeting the contract code the proposal claims. A
 * proposal whose ciphertext does not decrypt, or decrypts to something else,
 * cannot be signed at all.
 *
 * The same seed then decrypts the contract's reply after broadcast, so every
 * member can read what happened rather than only whoever pressed the button.
 *
 * ## What it costs
 *
 * The seed is in the proposal, so anyone holding the proposal can read the
 * message before it is sent. That is a real cost and it is the right trade:
 * every member can read it anyway — that is the point of reviewing it — and
 * what is bought is that none of them has to sign something they cannot read.
 * Bundles are encrypted in transit for this reason.
 *
 * The seed is **not** a signing key. Leaking it reveals a message's contents
 * to whoever holds it and grants no authority whatsoever over the account.
 *
 * It must be **fresh for every proposal**: the public half sits in the clear
 * inside the transaction on chain, so a reused seed publicly links two
 * otherwise unrelated transactions of the same group.
 */

import type { EncryptionUtils } from 'secretjs'

/** `encrypt()` returns nonce ‖ sender pubkey ‖ sealed bytes. */
export const NONCE_BYTES = 32
export const PUBKEY_BYTES = 32
const PREFIX_BYTES = NONCE_BYTES + PUBKEY_BYTES

/** A code hash is 32 bytes written as lowercase hex, and prefixes the plaintext. */
const CODE_HASH_CHARS = 64

let secretjs: Promise<typeof import('secretjs')> | undefined
function loadSecretjs(): Promise<typeof import('secretjs')> {
  // Cached like `src/store/wallet.ts` does it: several callers, one download.
  secretjs ??= import('secretjs')
  return secretjs
}

/* -------------------------------------------------------------------------- */
/* Seeds                                                                       */
/* -------------------------------------------------------------------------- */

export function newSeed(): Uint8Array {
  const seed = new Uint8Array(32)
  crypto.getRandomValues(seed)
  return seed
}

/**
 * The public half of a seed — the 32 bytes that ride in the clear inside every
 * message encrypted with it.
 *
 * Checking that these bytes are the ones in the ciphertext is what proves the
 * proposal's seed really is the key the message was encrypted with, rather
 * than a decoy seed shipped alongside a message encrypted to someone else.
 */
export async function seedPubkey(seed: Uint8Array): Promise<Uint8Array> {
  const { EncryptionUtilsImpl } = await loadSecretjs()
  return EncryptionUtilsImpl.GenerateNewKeyPairFromSeed(seed).pubkey
}

export async function utilsForSeed(lcdUrl: string, seed: Uint8Array): Promise<EncryptionUtils> {
  const { EncryptionUtilsImpl } = await loadSecretjs()
  return new EncryptionUtilsImpl(lcdUrl, seed)
}

/* -------------------------------------------------------------------------- */
/* Reading a ciphertext apart                                                  */
/* -------------------------------------------------------------------------- */

export function nonceOf(ciphertext: Uint8Array): Uint8Array {
  return ciphertext.slice(0, NONCE_BYTES)
}

export function senderPubkeyOf(ciphertext: Uint8Array): Uint8Array {
  return ciphertext.slice(NONCE_BYTES, PREFIX_BYTES)
}

export function sealedOf(ciphertext: Uint8Array): Uint8Array {
  return ciphertext.slice(PREFIX_BYTES)
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/* -------------------------------------------------------------------------- */
/* Verification                                                                */
/* -------------------------------------------------------------------------- */

export type CiphertextVerdict =
  /** The plaintext is byte-for-byte the message the proposal declares. */
  | { status: 'exact'; plaintext: string }
  /**
   * The plaintext parses to the same message, but was serialised differently
   * — different key order, different spacing. The contract will read it the
   * same way, and the difference is still worth showing: it means the
   * proposal was not built by this app, which is unusual enough to look at.
   */
  | { status: 'equivalent'; plaintext: string; detail: string }
  | { status: 'mismatch'; reason: string }

/**
 * Whether a ciphertext really says what a proposal claims it says.
 *
 * Four things have to hold, and each has its own message because each means
 * something different went wrong:
 *
 * 1. the ciphertext is long enough to contain its own framing;
 * 2. its sender pubkey is the one this seed produces — otherwise the seed in
 *    the proposal is not the key this was encrypted with, and both the review
 *    and the reply-decryption afterwards would be looking at the wrong thing;
 * 3. it decrypts, which is where the enclave's transaction key is actually
 *    exercised (this is the one step that touches the network, to read the
 *    chain's consensus IO public key);
 * 4. what comes out is the declared code hash followed by the declared
 *    message.
 *
 * Point 4 checks the **code hash** as well as the message, which matters more
 * than it looks: the hash is what the message is encrypted *to*, so a proposal
 * naming a contract address while encrypting to a different code hash is
 * exactly the shape of a swap-the-contract attack.
 */
export async function verifyCiphertext(params: {
  lcdUrl: string
  seed: Uint8Array
  ciphertext: Uint8Array
  declaredCodeHash: string
  declaredMsg: object
}): Promise<CiphertextVerdict> {
  const { ciphertext, declaredCodeHash } = params

  if (ciphertext.length <= PREFIX_BYTES) {
    return { status: 'mismatch', reason: 'The encrypted message is too short to be one.' }
  }

  const expectedPubkey = await seedPubkey(params.seed)
  if (!sameBytes(senderPubkeyOf(ciphertext), expectedPubkey)) {
    return {
      status: 'mismatch',
      reason:
        'This message was not encrypted with the key included in the proposal, so nothing about it ' +
        'can be checked. Do not sign it.'
    }
  }

  let plaintext: string
  try {
    const utils = await utilsForSeed(params.lcdUrl, params.seed)
    const decrypted = await utils.decrypt(sealedOf(ciphertext), nonceOf(ciphertext))
    plaintext = new TextDecoder().decode(decrypted)
  } catch (error) {
    return {
      status: 'mismatch',
      reason: `The encrypted message could not be decrypted: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  const codeHash = plaintext.slice(0, CODE_HASH_CHARS)
  const body = plaintext.slice(CODE_HASH_CHARS)

  if (codeHash.toLowerCase() !== declaredCodeHash.toLowerCase()) {
    return {
      status: 'mismatch',
      reason: `It is encrypted to contract code ${codeHash.slice(0, 12)}…, not the ${declaredCodeHash.slice(0, 12)}… this proposal names.`
    }
  }

  // Byte equality is the strong answer, and the one a proposal built by this
  // app will always give: both sides serialise the same rebuilt message.
  if (body === JSON.stringify(params.declaredMsg)) {
    return { status: 'exact', plaintext: body }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return { status: 'mismatch', reason: 'The encrypted message is not the JSON this proposal shows.' }
  }

  // Compared through a canonical serialisation rather than field by field, so
  // that key order — the usual reason for a benign difference — is not
  // mistaken for a different message.
  if (canonical(parsed) !== canonical(params.declaredMsg)) {
    return { status: 'mismatch', reason: 'The encrypted message is not the one this proposal shows.' }
  }

  return {
    status: 'equivalent',
    plaintext: body,
    detail: 'The message means the same thing but is written differently — this proposal was not built here.'
  }
}

/** JSON with object keys sorted at every level, for comparing values rather than spellings. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/* -------------------------------------------------------------------------- */
/* Re-encoding somebody else's message                                         */
/* -------------------------------------------------------------------------- */

export interface FixedCiphertext {
  codeHash: string
  msg: object
  ciphertext: Uint8Array
}

/**
 * An `EncryptionUtils` that hands back ciphertexts somebody else produced.
 *
 * The reason this exists: encryption draws a fresh random nonce, so a member
 * who re-encrypted the proposal's message would produce different bytes, a
 * different transaction, and a signature that fits nothing. The ciphertext
 * therefore has to be the proposer's — but the *encoding* of the message
 * around it should still be secretjs's own, because hand-writing a second
 * encoder next to secretjs's is how two encoders quietly drift apart and a
 * group signs a transaction nobody rendered.
 *
 * So: the member rebuilds the message from the proposal's declared intent,
 * hands it to secretjs's own `toProto`/`toAmino`, and this shim supplies the
 * verified ciphertext at the point where secretjs would have encrypted. The
 * result is byte-identical to the proposer's without trusting a single byte of
 * theirs that has not been checked.
 *
 * It refuses to encrypt anything it was not given, so it can never invent
 * bytes to paper over a mismatch. Entries are consumed as they are used, so
 * two identical messages in one transaction each get their own ciphertext
 * rather than sharing one.
 */
export function fixedCiphertextUtils(base: EncryptionUtils, entries: FixedCiphertext[]): EncryptionUtils {
  const remaining = entries.map((entry) => ({ ...entry, used: false }))

  return {
    getPubkey: () => base.getPubkey(),
    getTxEncryptionKey: (nonce: Uint8Array) => base.getTxEncryptionKey(nonce),
    decrypt: (ciphertext: Uint8Array, nonce: Uint8Array) => base.decrypt(ciphertext, nonce),
    encrypt: async (codeHash: string, msg: object) => {
      const wanted = JSON.stringify(msg)
      const entry = remaining.find(
        (candidate) =>
          !candidate.used &&
          candidate.codeHash.toLowerCase() === codeHash.toLowerCase() &&
          JSON.stringify(candidate.msg) === wanted
      )

      if (!entry) {
        throw new Error(
          'This transaction asked to encrypt a message the proposal does not contain. Nothing was signed.'
        )
      }

      entry.used = true
      return entry.ciphertext
    }
  }
}

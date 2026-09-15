/**
 * Legacy amino multisig accounts — the kind `secretcli keys add --multisig`
 * makes, and the kind multisig.keplr.app drives.
 *
 * Not a contract. Secret mainnet has `MsgStoreCode` and `MsgInstantiateContract`
 * disabled chain-wide by the circuit breaker (proposal 370), so a cw3-style
 * multisig cannot be deployed at all; and even without that, this kind costs
 * nothing to create, is understood by `secretcli`, and needs no code to keep
 * working. The account is a hash of its members' public keys and its threshold,
 * and that is the whole of it: there is no state anywhere, on chain or off,
 * that this file's functions cannot re-derive.
 *
 * Which is exactly why the derivation has to be right. A wrong public key
 * produces a perfectly valid address that nobody holds the keys to, and coins
 * sent there are gone. The derivation here is `@cosmjs/amino`'s, checked
 * against `secretcli 1.25.0` on a 2-of-3: same sort order, same address. The
 * vectors from that check live in `scripts/test-multisig.ts` so the agreement
 * is re-proved on every run rather than remembered.
 *
 * Nothing here touches a wallet, a key, or the network.
 */

import { sha256 } from '@cosmjs/crypto'
import {
  createMultisigThresholdPubkey,
  encodeSecp256k1Pubkey,
  pubkeyToAddress,
  type MultisigThresholdPubkey,
  type SinglePubkey
} from '@cosmjs/amino'
import { fromBase64, toHex, toUtf8 } from '@cosmjs/encoding'

import { BECH32_PREFIX, CHAIN_ID } from '@/chains/secret4'
import { isValidBech32 } from '@/lib/bech32'

/* -------------------------------------------------------------------------- */
/* Shape                                                                       */
/* -------------------------------------------------------------------------- */

export interface MultisigMember {
  /** `secret1…`, derived from the key rather than taken on trust. */
  address: string
  /** Compressed secp256k1, base64 — the spelling wallets and the chain both use. */
  pubkey: string
  /** The user's own label for this person. Local, never part of the identity. */
  label?: string
}

export interface MultisigConfig {
  version: 1
  chainId: string
  /** What the user calls this account. Local, like a contact name. */
  label: string
  threshold: number
  /**
   * In derivation order, not the order they were typed.
   *
   * The order is part of the address: the SDK sorts members by their raw
   * address before hashing, and storing the sorted list is what lets a member
   * check that everyone assembled the same account from the same keys.
   */
  members: MultisigMember[]
  /** Derived from the members and the threshold; stored so an import can be checked. */
  address: string
  /**
   * A random key shared by the group, used to encrypt what travels between
   * members over Waku and to name the topic it travels on.
   *
   * Not consensus-critical and not a signing key — losing it costs the group
   * its private transport, not its funds. It lives in the config because the
   * config is the thing members already have to exchange once, carefully.
   */
  roomKey: string
}

/** A reason a configuration must not be used, or must be looked at twice. */
export interface ConfigProblem {
  severity: 'error' | 'warning'
  message: string
}

/* -------------------------------------------------------------------------- */
/* Limits                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Practical rather than protocol: the SDK imposes no ceiling, but every member
 * adds a public key to every transaction the account sends, and the gas for
 * verifying a threshold's worth of signatures is paid on each one. Twenty is
 * well past any group that still calls itself a group.
 */
export const MAX_MEMBERS = 20

/** An imported config is attacker-controlled text; it gets a size before it gets a parser. */
const MAX_CONFIG_BYTES = 16 * 1024

/* -------------------------------------------------------------------------- */
/* Keys and addresses                                                          */
/* -------------------------------------------------------------------------- */

export class InvalidPubkeyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidPubkeyError'
  }
}

/**
 * A base64 compressed secp256k1 key, as an amino pubkey.
 *
 * Rejects anything else loudly. This is the one input a user copies by hand
 * from another person, and a key that is malformed — or uncompressed, or an
 * ed25519 consensus key pasted by mistake — must not be allowed to reach the
 * derivation and silently produce an address nobody can spend from.
 */
export function toSinglePubkey(base64: string): SinglePubkey {
  let bytes: Uint8Array
  try {
    bytes = fromBase64(base64.trim())
  } catch {
    throw new InvalidPubkeyError('That is not valid base64.')
  }

  if (bytes.length !== 33 || (bytes[0] !== 0x02 && bytes[0] !== 0x03)) {
    throw new InvalidPubkeyError(
      'A member key must be a compressed secp256k1 public key: 33 bytes starting with 02 or 03.'
    )
  }

  return encodeSecp256k1Pubkey(bytes)
}

/** The `secret1…` account a single key controls. */
export function addressForPubkey(base64: string): string {
  return pubkeyToAddress(toSinglePubkey(base64), BECH32_PREFIX)
}

export interface DerivedMultisig {
  address: string
  /** The threshold pubkey itself, needed to assemble a signed transaction. */
  pubkey: MultisigThresholdPubkey
  /** Member keys in derivation order — base64, as they are stored. */
  order: string[]
}

/**
 * The account a set of keys and a threshold add up to.
 *
 * Sorted, because that is what `secretcli keys add --multisig` does by default
 * (`--nosort` is the exception, and an account built that way is a *different*
 * account). Sorting also means the order members happen to type their keys in
 * cannot change the result, which removes a whole class of "we each built it
 * and got different addresses" confusion.
 */
export function deriveMultisig(pubkeys: string[], threshold: number): DerivedMultisig {
  if (!Number.isInteger(threshold) || threshold < 1) {
    throw new Error('The threshold must be a whole number of at least 1.')
  }
  if (threshold > pubkeys.length) {
    throw new Error(`A threshold of ${threshold} cannot be met by ${pubkeys.length} members.`)
  }

  const multisig = createMultisigThresholdPubkey(pubkeys.map(toSinglePubkey), threshold)

  return {
    address: pubkeyToAddress(multisig, BECH32_PREFIX),
    pubkey: multisig,
    order: multisig.value.pubkeys.map((pubkey) => pubkey.value)
  }
}

/** The threshold pubkey for a config, rebuilt from what it stores. */
export function thresholdPubkeyFor(config: MultisigConfig): MultisigThresholdPubkey {
  // `nosort` is on: the members are already in derivation order, and sorting a
  // second time is not merely redundant — it would quietly repair a tampered
  // config rather than letting `assertDerives` catch it.
  return createMultisigThresholdPubkey(
    config.members.map((member) => toSinglePubkey(member.pubkey)),
    config.threshold,
    true
  )
}

/* -------------------------------------------------------------------------- */
/* Fingerprint                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A short code over exactly what the address is made of.
 *
 * It carries no information the address does not: both are hashes of the same
 * threshold and the same keys in the same order, so comparing either one is
 * comparing the whole account. The reason to have it is that people compare
 * these out loud, over a call, before sending money to the account — and
 * twenty hex characters in groups survive that, where forty-five characters of
 * bech32 do not.
 *
 * Eighty bits, so that forging a different member set with the same code is
 * not something an attacker does on a laptop while the call is still going.
 */
export function fingerprint(threshold: number, orderedPubkeys: string[]): string {
  const canonical = `secret-multisig:v1:${threshold}:${orderedPubkeys.join(',')}`
  const digest = toHex(sha256(toUtf8(canonical)))
    .slice(0, 20)
    .toUpperCase()
  return digest.match(/.{4}/g)!.join('-')
}

export function fingerprintOf(config: MultisigConfig): string {
  return fingerprint(
    config.threshold,
    config.members.map((member) => member.pubkey)
  )
}

/* -------------------------------------------------------------------------- */
/* Building and checking                                                       */
/* -------------------------------------------------------------------------- */

/** 32 bytes of transport key. Not a signing key — see `MultisigConfig.roomKey`. */
export function generateRoomKey(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return toHex(bytes)
}

export interface DraftMember {
  pubkey: string
  label?: string
}

/**
 * Turn a set of keys into a config, deriving everything derivable.
 *
 * Member addresses are computed here rather than accepted from the caller: an
 * address typed alongside a key is a claim, and the key is the fact. Where the
 * two disagree the key wins, and `validateConfig` is what tells the user that
 * they disagreed.
 */
export function createConfig(params: {
  label: string
  members: DraftMember[]
  threshold: number
  roomKey?: string
}): MultisigConfig {
  const derived = deriveMultisig(
    params.members.map((member) => member.pubkey),
    params.threshold
  )

  const labels = new Map(params.members.map((member) => [member.pubkey.trim(), member.label]))

  return {
    version: 1,
    chainId: CHAIN_ID,
    label: params.label.trim(),
    threshold: params.threshold,
    members: derived.order.map((pubkey) => ({
      address: addressForPubkey(pubkey),
      pubkey,
      label: labels.get(pubkey)
    })),
    address: derived.address,
    roomKey: params.roomKey ?? generateRoomKey()
  }
}

/**
 * Everything wrong with a configuration, worst first.
 *
 * Errors are refusals; warnings are things that are legal, occasionally
 * deliberate, and almost always a mistake — a threshold of one, which is not a
 * multisig at all, or a member who appears twice, whose single key then counts
 * twice towards the threshold.
 */
export function validateConfig(config: MultisigConfig): ConfigProblem[] {
  const problems: ConfigProblem[] = []
  const error = (message: string) => problems.push({ severity: 'error', message })
  const warn = (message: string) => problems.push({ severity: 'warning', message })

  if (config.chainId !== CHAIN_ID) {
    error(`This account belongs to ${config.chainId}, not ${CHAIN_ID}.`)
  }
  if (config.members.length === 0) {
    error('A multisig needs at least one member.')
    return problems
  }
  if (config.members.length > MAX_MEMBERS) {
    error(`${config.members.length} members is more than this app will drive (${MAX_MEMBERS}).`)
  }
  if (!Number.isInteger(config.threshold) || config.threshold < 1) {
    error('The threshold must be a whole number of at least 1.')
  }
  if (config.threshold > config.members.length) {
    error(
      `A threshold of ${config.threshold} can never be met by ${config.members.length} members — ` +
        'this account could not sign anything.'
    )
  }

  const seen = new Set<string>()
  for (const member of config.members) {
    if (seen.has(member.pubkey)) {
      warn(`${member.address} is listed twice, so one key counts twice towards the threshold.`)
    }
    seen.add(member.pubkey)

    let derived: string
    try {
      derived = addressForPubkey(member.pubkey)
    } catch (caught) {
      error(caught instanceof Error ? caught.message : 'A member key is not a valid public key.')
      continue
    }

    if (derived !== member.address) {
      error(`The key listed for ${member.address} actually belongs to ${derived}.`)
    }
    if (!isValidBech32(member.address, BECH32_PREFIX)) {
      error(`${member.address} is not a valid ${BECH32_PREFIX} address.`)
    }
  }

  if (config.threshold === 1 && config.members.length > 1) {
    warn('A threshold of 1 means any single member can move everything on their own.')
  }
  if (config.threshold === config.members.length && config.members.length > 2) {
    warn(
      `Every one of the ${config.members.length} members must sign. Losing any single key locks ` +
        'the account permanently.'
    )
  }

  if (!/^[0-9a-f]{64}$/.test(config.roomKey)) {
    error('The shared transport key is malformed.')
  }

  return problems
}

/**
 * The check that cannot be skipped: the address is the one these keys make.
 *
 * An imported config states its own address, and a tampered one could state
 * any address at all — a member's own, say, so that a "top up the multisig"
 * instruction sends money somewhere else entirely. Re-deriving is the only
 * answer to that, and it is cheap.
 */
export function assertDerives(config: MultisigConfig): void {
  const derived = deriveMultisig(
    config.members.map((member) => member.pubkey),
    config.threshold
  )

  if (derived.address !== config.address) {
    throw new Error(
      `These keys make ${derived.address}, but the account claims to be ${config.address}. Do not use it.`
    )
  }

  const declaredOrder = config.members.map((member) => member.pubkey).join(',')
  if (derived.order.join(',') !== declaredOrder) {
    throw new Error('The member keys are not in the order the chain derives them from. Do not use it.')
  }
}

export function isMember(config: MultisigConfig, address: string): boolean {
  return config.members.some((member) => member.address === address)
}

export function memberByAddress(config: MultisigConfig, address: string): MultisigMember | undefined {
  return config.members.find((member) => member.address === address)
}

/* -------------------------------------------------------------------------- */
/* Exchange                                                                    */
/* -------------------------------------------------------------------------- */

export function exportConfig(config: MultisigConfig): string {
  return JSON.stringify(config, null, 2)
}

/**
 * Parse a config somebody else produced.
 *
 * Strict on purpose, and in this order: size, then JSON, then every field's
 * type, then the derivation. Nothing is defaulted and nothing unknown is kept
 * — a config carrying a field this version does not understand is a config
 * written by something that is not this app, and the safe response to that is
 * to refuse rather than to ignore the part that was not understood.
 */
export function parseConfig(raw: string): MultisigConfig {
  if (raw.length > MAX_CONFIG_BYTES) {
    throw new Error('That is too large to be a multisig account.')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('That is not valid JSON.')
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('A multisig account is a JSON object.')
  }

  const known = new Set(['version', 'chainId', 'label', 'threshold', 'members', 'address', 'roomKey'])
  const surplus = Object.keys(parsed).filter((key) => !known.has(key))
  if (surplus.length > 0) {
    throw new Error(`Unexpected field: ${surplus[0]}.`)
  }

  const record = parsed as Record<string, unknown>
  if (record.version !== 1) throw new Error('This account was written by a different version.')
  if (typeof record.chainId !== 'string') throw new Error('The chain is missing.')
  if (typeof record.label !== 'string') throw new Error('The label is missing.')
  if (typeof record.address !== 'string') throw new Error('The address is missing.')
  if (typeof record.roomKey !== 'string') throw new Error('The shared transport key is missing.')
  if (typeof record.threshold !== 'number' || !Number.isInteger(record.threshold)) {
    throw new Error('The threshold is missing.')
  }
  if (!Array.isArray(record.members) || record.members.length === 0) {
    throw new Error('The member list is missing.')
  }
  if (record.members.length > MAX_MEMBERS) {
    throw new Error(`${record.members.length} members is more than this app will drive.`)
  }

  const members: MultisigMember[] = record.members.map((entry) => {
    if (typeof entry !== 'object' || entry === null) throw new Error('A member is malformed.')
    const member = entry as Record<string, unknown>
    if (typeof member.pubkey !== 'string') throw new Error('A member has no public key.')
    if (typeof member.address !== 'string') throw new Error('A member has no address.')
    if (member.label !== undefined && typeof member.label !== 'string') {
      throw new Error('A member label is malformed.')
    }
    return { address: member.address, pubkey: member.pubkey, label: member.label }
  })

  const config: MultisigConfig = {
    version: 1,
    chainId: record.chainId,
    label: record.label,
    threshold: record.threshold,
    members,
    address: record.address,
    roomKey: record.roomKey
  }

  // Cheap checks first so the expensive one runs on something well-formed, but
  // the derivation is what actually decides whether this is safe to keep.
  const errors = validateConfig(config).filter((problem) => problem.severity === 'error')
  if (errors.length > 0) throw new Error(errors[0].message)
  assertDerives(config)

  return config
}

/**
 * What travels between members, and the parser that refuses the rest.
 *
 * Three kinds of thing move between the people in a multisig: a proposal, a
 * signature for one, and a note that one was broadcast. They move by whatever
 * route is available — a file, the clipboard, a QR code, a Waku topic — and
 * none of those routes is trusted. Everything that arrives is attacker-
 * controlled text until this module has been through it.
 *
 * So the parsing here is strict to the point of being unfriendly: exact
 * version, no unknown fields at any level, every number a decimal string with
 * no leading zeros, every base64 field decoding to exactly the length it is
 * supposed to be, every address a valid bech32 for this chain, and a size
 * limit before any of that. A bundle with a field this version does not
 * understand was not written by this app, and the safe response is to refuse
 * it rather than to ignore the part that was not understood.
 *
 * ## What is deliberately not here
 *
 * A proposal does **not** carry the sign doc, and does not carry transaction
 * body bytes. Both are derivable from what it does carry, and a second copy of
 * a thing is a second thing to disagree with the first. The document is
 * rebuilt locally by every member from the fields below; the proof that
 * everyone rebuilt the same one is that their signatures verify against it.
 *
 * It does carry the encryption seed, which is the one piece of a proposal that
 * is a secret rather than a fact. See `encryption.ts` for why that is the
 * right trade, and note that it is why a bundle should not be posted somewhere
 * public.
 */

import { fromBase64 } from '@cosmjs/encoding'

import { BECH32_PREFIX, CHAIN_ID } from '@/chains/secret4'
import { isValidBech32 } from '@/lib/bech32'
import { isKnownTemplate, type DeclaredMsg } from '@/lib/multisig/messages'

export const BUNDLE_VERSION = 1

/**
 * Waku's own ceiling is 150 KB. Staying well under it leaves room for the
 * transport's framing, and a proposal anywhere near this size is not a
 * proposal anyone should be signing.
 */
export const MAX_BUNDLE_BYTES = 100_000

/** The chain's `max_memo_characters`. */
const MAX_MEMO = 256
const MAX_MESSAGES = 20
const MAX_TITLE = 120
const MAX_NOTE = 2_000

/* -------------------------------------------------------------------------- */
/* Shapes                                                                      */
/* -------------------------------------------------------------------------- */

export interface ProposalFee {
  amount: Array<{ denom: string; amount: string }>
  gas: string
  /** Someone else pays. Part of what gets signed — see `signdoc.ts`. */
  granter?: string
}

export interface Proposal {
  v: 1
  kind: 'proposal'
  /** Correlates signatures with the thing they sign. Not a security boundary. */
  id: string
  chainId: string
  /** Which account this is for, and the fingerprint that says which member set. */
  multisig: string
  fingerprint: string
  /** A claim about who wrote it. The signatures are the facts. */
  proposer: string
  createdAt: number
  title: string
  note?: string
  /** Both pinned when the proposal was composed; both part of what is signed. */
  accountNumber: string
  sequence: string
  fee: ProposalFee
  memo: string
  msgs: DeclaredMsg[]
  /** Base64, 32 bytes. Present when any message is a contract call. */
  seed?: string
}

export interface SignatureBundle {
  v: 1
  kind: 'signature'
  proposalId: string
  fingerprint: string
  /** Base64, 33 bytes. Must be one of the account's members. */
  pubkey: string
  /** Base64, 64 bytes: r ‖ s. */
  signature: string
  /**
   * Hex sha256 of the bytes that were signed.
   *
   * Carried so that a signature made against some *other* document is
   * reported as exactly that, rather than as a verification failure at
   * broadcast time — by which point a round of signing has been spent.
   */
  signBytesHash: string
  signedAt: number
}

export interface BroadcastReceipt {
  v: 1
  kind: 'broadcast'
  proposalId: string
  fingerprint: string
  txHash: string
  code: number
  height?: number
  broadcastAt: number
}

export type Envelope = Proposal | SignatureBundle | BroadcastReceipt

export class BundleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BundleError'
  }
}

/* -------------------------------------------------------------------------- */
/* Primitive checks                                                            */
/* -------------------------------------------------------------------------- */

function fail(message: string): never {
  throw new BundleError(message)
}

function object(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(`${what} is not an object.`)
  return value as Record<string, unknown>
}

function only(record: Record<string, unknown>, allowed: string[], what: string): void {
  const surplus = Object.keys(record).filter((key) => !allowed.includes(key))
  if (surplus.length > 0) fail(`${what} carries an unexpected field: ${surplus[0]}.`)
}

function text(record: Record<string, unknown>, key: string, max: number, what: string): string {
  const value = record[key]
  if (typeof value !== 'string') fail(`${what} has no ${key}.`)
  if (value.length > max) fail(`${what} has an over-long ${key}.`)
  return value
}

function optionalText(
  record: Record<string, unknown>,
  key: string,
  max: number,
  what: string
): string | undefined {
  if (record[key] === undefined) return undefined
  return text(record, key, max, what)
}

/**
 * A whole number as a decimal string.
 *
 * Leading zeros are refused rather than trimmed: `"007"` and `"7"` produce
 * different signed bytes, so accepting both would mean a document that
 * verifies for one member and not for another.
 */
function decimal(record: Record<string, unknown>, key: string, what: string): string {
  const value = record[key]
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) {
    fail(`${what} has a malformed ${key}.`)
  }
  return value
}

function timestamp(record: Record<string, unknown>, key: string, what: string): number {
  const value = record[key]
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    fail(`${what} has a malformed ${key}.`)
  return value
}

function address(record: Record<string, unknown>, key: string, what: string): string {
  const value = text(record, key, 120, what)
  if (!isValidBech32(value, BECH32_PREFIX)) fail(`${what} has an invalid ${key}.`)
  return value
}

function base64OfLength(value: string, length: number, what: string): string {
  let bytes: Uint8Array
  try {
    bytes = fromBase64(value)
  } catch {
    fail(`${what} is not valid base64.`)
  }
  if (bytes.length !== length) fail(`${what} is ${bytes.length} bytes, not ${length}.`)
  return value
}

function identifier(record: Record<string, unknown>, key: string, what: string): string {
  const value = text(record, key, 64, what)
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(value)) fail(`${what} has a malformed ${key}.`)
  return value
}

function fingerprintOf(record: Record<string, unknown>, what: string): string {
  const value = text(record, 'fingerprint', 32, what)
  if (!/^[0-9A-F]{4}(-[0-9A-F]{4}){4}$/.test(value)) fail(`${what} has a malformed fingerprint.`)
  return value
}

/* -------------------------------------------------------------------------- */
/* Parsing                                                                     */
/* -------------------------------------------------------------------------- */

function parseFee(raw: unknown): ProposalFee {
  const record = object(raw, 'The fee')

  // Checked before the surplus-field sweep, so that the one surplus field
  // somebody might plausibly set gets an answer rather than a shrug: a payer
  // must sign the transaction, and this flow has no way to collect that
  // signature.
  if ('payer' in record) fail('The fee names a payer, which a multisig proposal cannot use.')

  only(record, ['amount', 'gas', 'granter'], 'The fee')

  if (!Array.isArray(record.amount) || record.amount.length === 0 || record.amount.length > 4) {
    fail('The fee has a malformed amount.')
  }

  const amount = record.amount.map((entry) => {
    const coin = object(entry, 'A fee amount')
    only(coin, ['denom', 'amount'], 'A fee amount')
    const denom = text(coin, 'denom', 128, 'A fee amount')
    if (!/^[a-zA-Z][a-zA-Z0-9/:._-]{2,127}$/.test(denom)) fail('A fee amount has a malformed denom.')
    return { denom, amount: decimal(coin, 'amount', 'A fee amount') }
  })

  const fee: ProposalFee = { amount, gas: decimal(record, 'gas', 'The fee') }
  if (record.granter !== undefined) fee.granter = address(record, 'granter', 'The fee')

  return fee
}

function parseMessages(raw: unknown): DeclaredMsg[] {
  if (!Array.isArray(raw) || raw.length === 0) fail('The proposal contains no messages.')
  if (raw.length > MAX_MESSAGES)
    fail(`The proposal contains ${raw.length} messages, which is more than ${MAX_MESSAGES}.`)

  return raw.map((entry) => {
    const record = object(entry, 'A message')
    only(record, ['template', 'content', 'ciphertext'], 'A message')

    const template = text(record, 'template', 64, 'A message')
    if (!isKnownTemplate(template)) {
      fail(`This proposal contains a "${template}" message, which this app cannot build or check.`)
    }

    const content = object(record.content, 'A message body')
    const declared: DeclaredMsg = { template, content }

    if (record.ciphertext !== undefined) {
      const ciphertext = text(record, 'ciphertext', MAX_BUNDLE_BYTES, 'A message')
      let bytes: Uint8Array
      try {
        bytes = fromBase64(ciphertext)
      } catch {
        fail('A message has an encrypted body that is not valid base64.')
      }
      // 32 bytes of nonce and 32 of sender key, before anything encrypted.
      if (bytes.length <= 64) fail('A message has an encrypted body too short to be one.')
      declared.ciphertext = ciphertext
    }

    return declared
  })
}

function parseProposal(record: Record<string, unknown>): Proposal {
  only(
    record,
    [
      'v',
      'kind',
      'id',
      'chainId',
      'multisig',
      'fingerprint',
      'proposer',
      'createdAt',
      'title',
      'note',
      'accountNumber',
      'sequence',
      'fee',
      'memo',
      'msgs',
      'seed'
    ],
    'The proposal'
  )

  const proposal: Proposal = {
    v: 1,
    kind: 'proposal',
    id: identifier(record, 'id', 'The proposal'),
    chainId: text(record, 'chainId', 64, 'The proposal'),
    multisig: address(record, 'multisig', 'The proposal'),
    fingerprint: fingerprintOf(record, 'The proposal'),
    proposer: address(record, 'proposer', 'The proposal'),
    createdAt: timestamp(record, 'createdAt', 'The proposal'),
    title: text(record, 'title', MAX_TITLE, 'The proposal'),
    note: optionalText(record, 'note', MAX_NOTE, 'The proposal'),
    accountNumber: decimal(record, 'accountNumber', 'The proposal'),
    sequence: decimal(record, 'sequence', 'The proposal'),
    fee: parseFee(record.fee),
    memo: text(record, 'memo', MAX_MEMO, 'The proposal'),
    msgs: parseMessages(record.msgs)
  }

  if (record.seed !== undefined) {
    proposal.seed = base64OfLength(text(record, 'seed', 64, 'The proposal'), 32, 'The encryption seed')
  }

  // Not a chain check — that comes later, with a node to ask — but a proposal
  // for another chain can never be signed here and saying so now is clearer
  // than failing on a mismatched document afterwards.
  if (proposal.chainId !== CHAIN_ID) {
    fail(`This proposal is for ${proposal.chainId}, not ${CHAIN_ID}.`)
  }

  // A contract call that brought no ciphertext cannot be reviewed, and one
  // this app would have to encrypt itself would produce different bytes from
  // every other member's. Either way it is unsignable.
  for (const message of proposal.msgs) {
    if (message.template === 'MsgExecuteContract' && !message.ciphertext) {
      fail('A contract call in this proposal carries no encrypted body.')
    }
    if (message.ciphertext && !proposal.seed) {
      fail('This proposal has an encrypted message but no key to check it with.')
    }
  }

  return proposal
}

function parseSignature(record: Record<string, unknown>): SignatureBundle {
  only(
    record,
    ['v', 'kind', 'proposalId', 'fingerprint', 'pubkey', 'signature', 'signBytesHash', 'signedAt'],
    'The signature'
  )

  const signBytesHash = text(record, 'signBytesHash', 64, 'The signature')
  if (!/^[0-9a-f]{64}$/.test(signBytesHash)) fail('The signature has a malformed document hash.')

  return {
    v: 1,
    kind: 'signature',
    proposalId: identifier(record, 'proposalId', 'The signature'),
    fingerprint: fingerprintOf(record, 'The signature'),
    pubkey: base64OfLength(text(record, 'pubkey', 64, 'The signature'), 33, 'The signing key'),
    signature: base64OfLength(text(record, 'signature', 128, 'The signature'), 64, 'The signature'),
    signBytesHash,
    signedAt: timestamp(record, 'signedAt', 'The signature')
  }
}

function parseReceipt(record: Record<string, unknown>): BroadcastReceipt {
  only(
    record,
    ['v', 'kind', 'proposalId', 'fingerprint', 'txHash', 'code', 'height', 'broadcastAt'],
    'The receipt'
  )

  const txHash = text(record, 'txHash', 64, 'The receipt')
  if (!/^[0-9A-Fa-f]{64}$/.test(txHash)) fail('The receipt has a malformed transaction hash.')

  const code = record.code
  if (typeof code !== 'number' || !Number.isSafeInteger(code) || code < 0)
    fail('The receipt has a malformed code.')

  const receipt: BroadcastReceipt = {
    v: 1,
    kind: 'broadcast',
    proposalId: identifier(record, 'proposalId', 'The receipt'),
    fingerprint: fingerprintOf(record, 'The receipt'),
    txHash: txHash.toUpperCase(),
    code,
    broadcastAt: timestamp(record, 'broadcastAt', 'The receipt')
  }

  if (record.height !== undefined) receipt.height = timestamp(record, 'height', 'The receipt')

  return receipt
}

/** Parse anything that arrived, from any route. */
export function parseEnvelope(raw: unknown): Envelope {
  const record = object(raw, 'That')
  if (record.v !== BUNDLE_VERSION) fail('That was written by a different version of this app.')

  switch (record.kind) {
    case 'proposal':
      return parseProposal(record)
    case 'signature':
      return parseSignature(record)
    case 'broadcast':
      return parseReceipt(record)
    default:
      fail('That is not a proposal, a signature or a receipt.')
  }
}

/* -------------------------------------------------------------------------- */
/* Text form                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Names what follows, so a blob pasted into the wrong box is met with an
 * explanation rather than a parser error.
 */
const TEXT_PREFIX = 'secret-multisig:v1:'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

/** One line, safe to paste anywhere a line of text goes. */
export function encodeText(envelope: Envelope): string {
  const json = JSON.stringify(envelope)
  if (json.length > MAX_BUNDLE_BYTES) {
    throw new BundleError('That is too large to share in one piece.')
  }
  return TEXT_PREFIX + toBase64Url(encoder.encode(json))
}

export function decodeText(value: string): Envelope {
  const trimmed = value.trim()
  if (!trimmed.startsWith(TEXT_PREFIX)) {
    throw new BundleError('That does not look like something from a multisig.')
  }

  const body = trimmed.slice(TEXT_PREFIX.length)
  if (body.length > MAX_BUNDLE_BYTES) throw new BundleError('That is too large to be a multisig bundle.')

  let json: string
  try {
    json = decoder.decode(fromBase64Url(body))
  } catch {
    throw new BundleError('That is damaged — it may have been cut short on the way here.')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new BundleError('That is damaged — it may have been cut short on the way here.')
  }

  return parseEnvelope(parsed)
}

/**
 * The binary form, for a transport that carries bytes.
 *
 * Deliberately the plain JSON rather than the text form's base64: Waku already
 * frames and encrypts what it carries, so encoding it a second time would only
 * make every message a third larger for nothing.
 */
export function encodeEnvelope(envelope: Envelope): Uint8Array {
  const json = JSON.stringify(envelope)
  if (json.length > MAX_BUNDLE_BYTES) {
    throw new BundleError('That is too large to share in one piece.')
  }
  return encoder.encode(json)
}

/**
 * Read one back.
 *
 * Bytes off a public topic are the least trusted input this app has — anyone
 * can publish to a topic they know — so they go through exactly the parser
 * everything else does, and a message that is not a bundle at all is a
 * refusal rather than a crash.
 */
export function decodeEnvelope(bytes: Uint8Array): Envelope {
  if (bytes.length > MAX_BUNDLE_BYTES) throw new BundleError('That is too large to be a multisig bundle.')

  let parsed: unknown
  try {
    parsed = JSON.parse(decoder.decode(bytes))
  } catch {
    throw new BundleError('That is not a multisig bundle.')
  }

  return parseEnvelope(parsed)
}

/** The same thing as a file, for the route where a line of text is awkward. */
export function encodeJson(envelope: Envelope): string {
  const json = JSON.stringify(envelope, null, 2)
  if (json.length > MAX_BUNDLE_BYTES) throw new BundleError('That is too large to share in one piece.')
  return json
}

export function decodeJson(raw: string): Envelope {
  if (raw.length > MAX_BUNDLE_BYTES) throw new BundleError('That is too large to be a multisig bundle.')

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new BundleError('That is not valid JSON.')
  }

  return parseEnvelope(parsed)
}

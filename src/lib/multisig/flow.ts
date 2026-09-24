/**
 * The life of a proposal: composed, rebuilt, signed, assembled, broadcast.
 *
 * Each step is a plain function taking what it needs, so the screens stay thin
 * and the sequence is legible in one file. The sequence itself is the design:
 *
 *   compose   → the proposer encrypts once, and publishes intent plus the key
 *               to check it with
 *   rebuild   → every member reproduces the transaction from that intent,
 *               reusing the proposer's verified ciphertext and nothing else
 *   sign      → the wallet signs the rebuilt document, and the signature is
 *               checked against it before it is kept
 *   assemble  → a threshold of checked signatures becomes one transaction
 *   broadcast → and the reply is decrypted with the proposal's own key, so
 *               every member can read what the contract said
 *
 * Nothing in here trusts a proposal, and `rebuild` in particular does not
 * trust that anything was checked before it. It decrypts every ciphertext
 * against the message the proposal declares and refuses to build a transaction
 * when the two disagree — because rebuilding is what produces the document a
 * wallet is asked to sign, and a safe screen cannot depend on being called in
 * the right order.
 */

import { fromBase64, toBase64 } from '@cosmjs/encoding'
import { Secp256k1, Secp256k1Signature, sha256 } from '@cosmjs/crypto'
import type { EncryptionUtils, Msg, SecretNetworkClient, TxResponse } from 'secretjs'

import { DENOM, GAS_PRICE_USCRT } from '@/chains/secret4'
import { codeHashFor } from '@/lib/codeHash'
import type { Proposal, ProposalFee, SignatureBundle } from '@/lib/multisig/bundle'
import { fingerprintOf, thresholdPubkeyFor, type MultisigConfig } from '@/lib/multisig/config'
import { requireAccountMeta } from '@/lib/multisig/account'
import { assembleTx, buildBodyBytes, type EncodedMsg } from '@/lib/multisig/assemble'
import {
  fixedCiphertextUtils,
  newSeed,
  utilsForSeed,
  verifyCiphertext,
  type FixedCiphertext
} from '@/lib/multisig/encryption'
import { buildMsgs, computeEntries, defaultGasFor, type DeclaredMsg } from '@/lib/multisig/messages'
import { docsEqual, signBytes, signBytesHash } from '@/lib/multisig/signdoc'
import { buildDocFor } from '@/lib/multisig/verify'
import { trackTx } from '@/lib/txProgress'
import type { AminoSignDoc, KeplrLike } from '@/lib/wallet'

let secretjs: Promise<typeof import('secretjs')> | undefined
function loadSecretjs(): Promise<typeof import('secretjs')> {
  secretjs ??= import('secretjs')
  return secretjs
}

/** An amino message as a sign doc holds it. */
type AminoMsg = { type: string; value: unknown }

/* -------------------------------------------------------------------------- */
/* Fees                                                                        */
/* -------------------------------------------------------------------------- */

export function feeFor(gasLimit: number, granter?: string): ProposalFee {
  return {
    amount: [{ denom: DENOM, amount: String(Math.ceil(gasLimit * GAS_PRICE_USCRT)) }],
    gas: String(gasLimit),
    ...(granter ? { granter } : {})
  }
}

/* -------------------------------------------------------------------------- */
/* Compose                                                                     */
/* -------------------------------------------------------------------------- */

export interface ComposeInput {
  client: SecretNetworkClient
  lcdUrl: string
  config: MultisigConfig
  /** Who says they wrote it. A claim; their signature is the fact. */
  proposer: string
  title: string
  note?: string
  messages: DeclaredMsg[]
  memo?: string
  /** Defaults to `defaultGasFor` — editable, because contract calls cannot be simulated. */
  gasLimit?: number
  granter?: string
  /**
   * Sign for a later sequence, to queue a proposal behind one already out for
   * signature. Rare and deliberate: the transaction cannot be broadcast until
   * the one in front of it has been.
   */
  sequence?: string
}

/**
 * Turn intent into a proposal.
 *
 * The encryption happens exactly once, here, and its seed goes into the
 * proposal so that everyone else can check the result rather than repeat it.
 * Code hashes are pinned at this moment too: a hash looked up later is a hash
 * that could have been looked up from a different contract.
 */
export async function composeProposal(input: ComposeInput): Promise<Proposal> {
  const secret = await loadSecretjs()
  const account = await requireAccountMeta(input.client, input.config.address)

  // Pin every contract call to the code it is being encrypted to, before any
  // encryption happens, so the pin and the ciphertext cannot disagree.
  const messages: DeclaredMsg[] = []
  for (const message of input.messages) {
    if (message.template !== 'MsgExecuteContract') {
      messages.push({ ...message, content: { ...message.content } })
      continue
    }

    const content = { ...message.content }
    if (!content.code_hash) {
      content.code_hash = await codeHashFor(input.client, String(content.contract_address ?? ''))
    }
    messages.push({ ...message, content })
  }

  const needsSeed = computeEntries(messages).length > 0
  const seed = needsSeed ? newSeed() : undefined
  const utils = seed ? await utilsForSeed(input.lcdUrl, seed) : undefined

  const built = buildMsgs(secret, messages)
  const amino = await toAmino(built, utils)

  // The ciphertext secretjs just produced, read back out of the amino form so
  // that what travels is exactly what was encoded — not a second encryption.
  const withCiphertexts = messages.map((message, index) => {
    if (message.template !== 'MsgExecuteContract') return message
    const value = amino[index]?.value as { msg?: string } | undefined
    if (!value?.msg) throw new Error('secretjs did not produce an encrypted body for a contract call.')
    return { ...message, ciphertext: value.msg }
  })

  const gasLimit =
    input.gasLimit ?? defaultGasFor(messages, input.config.members.length, input.config.threshold)

  return {
    v: 1,
    kind: 'proposal',
    id: newProposalId(),
    chainId: input.config.chainId,
    multisig: input.config.address,
    fingerprint: fingerprintOf(input.config),
    proposer: input.proposer,
    createdAt: Date.now(),
    title: input.title.trim(),
    note: input.note?.trim() || undefined,
    accountNumber: account.accountNumber,
    sequence: input.sequence ?? account.sequence,
    fee: feeFor(gasLimit, input.granter),
    memo: input.memo ?? '',
    msgs: withCiphertexts,
    seed: seed ? toBase64(seed) : undefined
  }
}

/** Long enough not to collide by accident; it correlates, it does not authorise. */
function newProposalId(): string {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/* -------------------------------------------------------------------------- */
/* Rebuild                                                                     */
/* -------------------------------------------------------------------------- */

export interface Rebuilt {
  /** What the wallet will be asked to sign. */
  doc: AminoSignDoc
  /** The protobuf messages, for assembling the transaction afterwards. */
  encoded: EncodedMsg[]
  /** Convenience: the transaction body, which is messages and memo only. */
  bodyBytes: Uint8Array
}

/**
 * Reproduce a proposal's transaction locally.
 *
 * This is what makes the whole scheme honest: the member's screen shows a
 * transaction their own machine built from declared intent, not one handed to
 * them. The only imported bytes are the ciphertexts, which cannot be
 * reproduced — and which `verifyProposal` has checked against that same intent
 * before this runs.
 */
export async function rebuildProposal(lcdUrl: string, proposal: Proposal): Promise<Rebuilt> {
  const secret = await loadSecretjs()

  let utils: EncryptionUtils | undefined
  const entries = computeEntries(proposal.msgs)
  if (entries.length > 0) {
    if (!proposal.seed)
      throw new Error('This proposal has an encrypted message but no key to rebuild it with.')

    const seed = fromBase64(proposal.seed)
    const base = await utilsForSeed(lcdUrl, seed)
    const fixed: FixedCiphertext[] = []

    for (const entry of entries) {
      if (!entry.ciphertext) throw new Error('A contract call in this proposal carries no encrypted body.')
      const ciphertext = fromBase64(entry.ciphertext)

      /*
       * Verified here, and not only by the checklist.
       *
       * The shim matches a ciphertext to the message the proposal *declares*,
       * so on its own it would happily hand over the proposer's bytes for a
       * message that says something else entirely — the declaration is the
       * attacker's to write. Only decryption can tell the two apart, so this
       * path does it rather than trusting that `verifyProposal` was called
       * first. Rebuilding is what produces the document a wallet is then asked
       * to sign; it has to be safe on its own.
       */
      const verdict = await verifyCiphertext({
        lcdUrl,
        seed,
        ciphertext,
        declaredCodeHash: entry.codeHash,
        declaredMsg: entry.msg
      })
      if (verdict.status === 'mismatch') {
        throw new Error(
          `Message ${entry.index + 1} does not contain what this proposal says it does: ${verdict.reason}`
        )
      }

      fixed.push({ codeHash: entry.codeHash, msg: entry.msg, ciphertext })
    }

    utils = fixedCiphertextUtils(base, fixed)
  }

  const built = buildMsgs(secret, proposal.msgs)
  const amino = await toAmino(built, utils)
  const encoded = await toEncoded(built, utils)

  return {
    doc: buildDocFor(proposal, amino),
    encoded,
    bodyBytes: buildBodyBytes(encoded, proposal.memo)
  }
}

async function toAmino(messages: Msg[], utils?: EncryptionUtils): Promise<AminoMsg[]> {
  return Promise.all(messages.map((message) => message.toAmino(utils as EncryptionUtils)))
}

async function toEncoded(messages: Msg[], utils?: EncryptionUtils): Promise<EncodedMsg[]> {
  return Promise.all(
    messages.map(async (message) => {
      const proto = await message.toProto(utils as EncryptionUtils)
      return { typeUrl: proto.type_url, value: await proto.encode() }
    })
  )
}

/* -------------------------------------------------------------------------- */
/* Sign                                                                        */
/* -------------------------------------------------------------------------- */

export class SignatureRefused extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SignatureRefused'
  }
}

/**
 * Sign the rebuilt document, and check what comes back before keeping it.
 *
 * Two checks, both of which have caught real wallets misbehaving in other
 * apps. The wallet is asked not to set its own fee or memo, and the document
 * it says it signed is compared with the one it was given — a wallet that
 * "helpfully" adjusts either produces a signature for a transaction nobody
 * reviewed. And the signature is verified locally: a member should never carry
 * a signature to the rest of the group without knowing it is good.
 */
export async function signProposal(params: {
  provider: KeplrLike
  signer: string
  proposal: Proposal
  doc: AminoSignDoc
}): Promise<SignatureBundle> {
  const { signed, signature } = await params.provider.signAmino(
    params.proposal.chainId,
    params.signer,
    params.doc,
    { preferNoSetFee: true, preferNoSetMemo: true }
  )

  if (!docsEqual(signed, params.doc)) {
    throw new SignatureRefused(
      'Your wallet changed the transaction before signing it — most often the fee. The signature would not ' +
        'have matched what the group reviewed, so it was discarded.'
    )
  }

  const pubkey = signature.pub_key?.value
  if (typeof pubkey !== 'string') {
    throw new SignatureRefused('Your wallet returned a signature with no public key.')
  }

  const valid = await Secp256k1.verifySignature(
    Secp256k1Signature.fromFixedLength(fromBase64(signature.signature)),
    sha256(signBytes(params.doc)),
    fromBase64(pubkey)
  )
  if (!valid) {
    throw new SignatureRefused('Your wallet produced a signature that does not verify. Nothing was kept.')
  }

  return {
    v: 1,
    kind: 'signature',
    proposalId: params.proposal.id,
    fingerprint: params.proposal.fingerprint,
    pubkey,
    signature: signature.signature,
    signBytesHash: signBytesHash(params.doc),
    signedAt: Date.now()
  }
}

/* -------------------------------------------------------------------------- */
/* Assemble and broadcast                                                      */
/* -------------------------------------------------------------------------- */

/**
 * One transaction out of a threshold of signatures.
 *
 * Takes signatures already verified by `verifyCollected` — assembling
 * unverified ones would produce a transaction that fails at the node with a
 * message naming nothing useful.
 */
export function assembleProposal(params: {
  config: MultisigConfig
  proposal: Proposal
  bodyBytes: Uint8Array
  signatures: Map<string, Uint8Array>
}): Uint8Array {
  return assembleTx({
    pubkey: thresholdPubkeyFor(params.config),
    sequence: params.proposal.sequence,
    fee: params.proposal.fee,
    bodyBytes: params.bodyBytes,
    signatures: params.signatures
  })
}

/**
 * Send it, and read the reply.
 *
 * The client is built with the proposal's own encryption seed, which is what
 * lets *any* member decrypt the contract's response — including its error
 * message, which on Secret is encrypted too and is otherwise readable only by
 * whoever composed the transaction.
 */
export async function broadcastProposal(params: {
  lcdUrl: string
  chainId: string
  txBytes: Uint8Array
  seed?: string
}): Promise<TxResponse> {
  const { SecretNetworkClient } = await loadSecretjs()

  const client = new SecretNetworkClient({
    url: params.lcdUrl,
    chainId: params.chainId,
    ...(params.seed
      ? { encryptionUtils: (await utilsForSeed(params.lcdUrl, fromBase64(params.seed))) as never }
      : {})
  })

  // Already signed by every member, so the card starts at the block.
  const tracker = trackTx('Multisig transaction')
  tracker.confirming()
  try {
    const tx = await client.tx.broadcastSignedTx(params.txBytes, { waitForCommit: true })
    tracker.settle(tx)
    return tx
  } catch (error) {
    tracker.fail(error)
    throw error
  }
}

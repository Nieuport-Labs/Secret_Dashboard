/**
 * Turning a threshold's worth of signatures into a transaction the chain will
 * accept.
 *
 * ## Why this is not `@cosmjs/stargate`'s `makeMultisignedTx`
 *
 * That helper builds its `AuthInfo` as `{amount, gasLimit}` and nothing else,
 * so a fee `granter` — and a `payer` — are silently dropped. That is not a
 * missing feature, it is a correctness bug for this app: `StdFee` carries the
 * granter, `serializeSignDoc` puts it inside the bytes every member signed, and
 * the chain recomputes those bytes from the transaction it receives. Assemble
 * a granted transaction with the upstream helper and the recomputed document
 * differs from the signed one, so **every signature fails to verify** and a
 * whole round of signing is wasted on an `unauthorized` error that says
 * nothing about fees. This app grants fees on most transactions, so the copy
 * is unavoidable.
 *
 * Everything else here follows the upstream implementation deliberately,
 * including the shape of the `CompactBitArray`, because the checked-in vectors
 * in `scripts/test-multisig.ts` come from `secretcli` and the bytes have to
 * match it exactly.
 *
 * ## What the signatures do and do not cover
 *
 * The amino sign doc covers `chain_id`, `account_number`, `sequence`, `fee`,
 * `msgs` and `memo`. It does *not* cover the rest of the `TxBody` —
 * `timeout_height` and the two extension option lists. So the body built here
 * carries messages and memo and nothing else, and body bytes are never
 * accepted from outside: a proposal that could hand over a prepared body could
 * attach a timeout height nobody agreed to.
 */

import { encodePubkey } from '@cosmjs/proto-signing'
import type { MultisigThresholdPubkey, StdFee } from '@cosmjs/amino'
import { CompactBitArray, MultiSignature } from 'cosmjs-types/cosmos/crypto/multisig/v1beta1/multisig.js'
import { SignMode } from 'cosmjs-types/cosmos/tx/signing/v1beta1/signing.js'
import { AuthInfo, TxBody, TxRaw } from 'cosmjs-types/cosmos/tx/v1beta1/tx.js'

import { addressForPubkey } from '@/lib/multisig/config'

/** A message already encoded by secretjs: its type URL and its protobuf bytes. */
export interface EncodedMsg {
  typeUrl: string
  value: Uint8Array
}

/**
 * Which members signed, as the SDK wants it: one bit per member, in the
 * threshold pubkey's own order, most significant bit first.
 *
 * `extraBitsStored` is the number of bits used in the final byte — the field
 * is how the SDK knows that a 3-member array stored in one byte is three bits
 * and not eight.
 */
export function compactBitArray(bits: boolean[]): CompactBitArray {
  const byteCount = Math.ceil(bits.length / 8)
  const extraBits = bits.length - Math.floor(bits.length / 8) * 8
  const bytes = new Uint8Array(byteCount)

  bits.forEach((set, index) => {
    if (set) bytes[Math.floor(index / 8)] |= 0b1 << (8 - 1 - (index % 8))
  })

  return CompactBitArray.fromPartial({ elems: bytes, extraBitsStored: extraBits })
}

/**
 * The body of the transaction: the messages and the memo, exactly as signed.
 *
 * No timeout height, no extension options — see the module comment. The memo
 * must be the one from the signed document rather than the one the composer
 * started with, because a wallet is allowed to have changed it (and if it did,
 * the signing screen refuses the signature before it ever gets here).
 */
export function buildBodyBytes(messages: EncodedMsg[], memo: string): Uint8Array {
  return TxBody.encode(
    TxBody.fromPartial({
      messages: messages.map((message) => ({ typeUrl: message.typeUrl, value: message.value })),
      memo
    })
  ).finish()
}

export interface AssembleInput {
  /** The account's own threshold pubkey, rebuilt from the config. */
  pubkey: MultisigThresholdPubkey
  /** The sequence that was signed. Not re-read from the chain — see `verify.ts`. */
  sequence: string
  /** The fee that was signed, granter included. */
  fee: StdFee
  bodyBytes: Uint8Array
  /** Signatures by member address. Order here is irrelevant; member order decides. */
  signatures: Map<string, Uint8Array>
}

export class AssemblyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AssemblyError'
  }
}

/**
 * The signed transaction, ready to broadcast.
 *
 * Signatures are placed by *member* order, not by the order they arrived in:
 * the bit array and the signature list are read in parallel by the chain, so a
 * signature in the wrong slot is verified against the wrong member's key and
 * the transaction fails as a whole.
 */
export function assembleTx(input: AssembleInput): Uint8Array {
  if (input.fee.payer) {
    // A payer has to sign the transaction themselves, and this flow has no way
    // to collect that signature. Refusing is better than producing a
    // transaction that can only fail.
    throw new AssemblyError('A fee payer cannot be used here — only a granter, who does not sign.')
  }

  const members = input.pubkey.value.pubkeys.map((pubkey) => addressForPubkey(pubkey.value))
  const unknown = [...input.signatures.keys()].filter((address) => !members.includes(address))
  if (unknown.length > 0) {
    throw new AssemblyError(`${unknown[0]} is not a member of this account.`)
  }

  const threshold = Number(input.pubkey.value.threshold)
  if (input.signatures.size < threshold) {
    throw new AssemblyError(`${input.signatures.size} of the ${threshold} required signatures are in.`)
  }

  const signed: boolean[] = []
  const ordered: Uint8Array[] = []
  for (const member of members) {
    const signature = input.signatures.get(member)
    signed.push(Boolean(signature))
    if (signature) ordered.push(signature)
  }

  const authInfo = AuthInfo.fromPartial({
    signerInfos: [
      {
        publicKey: encodePubkey(input.pubkey),
        modeInfo: {
          multi: {
            bitarray: compactBitArray(signed),
            modeInfos: ordered.map(() => ({ single: { mode: SignMode.SIGN_MODE_LEGACY_AMINO_JSON } }))
          }
        },
        sequence: BigInt(input.sequence)
      }
    ],
    fee: {
      amount: input.fee.amount.map((coin) => ({ denom: coin.denom, amount: coin.amount })),
      gasLimit: BigInt(input.fee.gas),
      // The two fields the upstream helper drops. See the module comment.
      granter: input.fee.granter ?? '',
      payer: ''
    }
  })

  return TxRaw.encode(
    TxRaw.fromPartial({
      bodyBytes: input.bodyBytes,
      authInfoBytes: AuthInfo.encode(authInfo).finish(),
      // One entry, however many members signed: the multisig's single
      // "signature" is the whole `MultiSignature` structure.
      signatures: [MultiSignature.encode(MultiSignature.fromPartial({ signatures: ordered })).finish()]
    })
  ).finish()
}

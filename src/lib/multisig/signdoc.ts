/**
 * The document every member of a multisig signs, and the bytes that come out
 * of it.
 *
 * A multisig signature is ordinary in every way except one: all the signers
 * sign the *same* `StdSignDoc`, so it has to be byte-reproducible from the
 * proposal alone. Everything that goes into it is therefore either fixed by
 * the chain (`chain_id`, `account_number`, `sequence`) or carried explicitly
 * in the proposal (`fee`, `memo`, `msgs`). Nothing may be filled in locally by
 * whoever happens to be signing, which is why the signing screen refuses a
 * document the wallet edited on its way through.
 *
 * `serializeSignDoc` is re-exported rather than reimplemented. It sorts keys,
 * and it escapes `&`, `<` and `>` inside string values — two details that a
 * second implementation gets subtly wrong and that would turn into signatures
 * the chain rejects for no visible reason. There is one reference
 * implementation in the dependency tree and this is it.
 *
 * ## The fee granter is part of the signature
 *
 * `StdFee` carries `granter`, and it is inside the serialised bytes: the same
 * document with and without a granter hashes differently. That makes the
 * granter a *signed* field, and any code that assembles the final transaction
 * has to put it back exactly as signed — see the warning in `assemble.ts`
 * about `@cosmjs/stargate`'s own multisig helper, which does not.
 */

import { serializeSignDoc, type StdFee } from '@cosmjs/amino'
import { sha256 } from '@cosmjs/crypto'
import { toHex } from '@cosmjs/encoding'

import type { AminoSignDoc } from '@/lib/wallet'

export interface SignDocInput {
  chainId: string
  accountNumber: string
  sequence: string
  fee: StdFee
  memo: string
  msgs: Array<{ type: string; value: unknown }>
}

/**
 * Built by hand rather than with `makeSignDoc`, for one reason: the field
 * order of the object is irrelevant (serialisation sorts it), but an explicit
 * literal makes it obvious that `timeout_height` is absent. A sign doc that
 * carries one is a different document, and the assembler deliberately builds a
 * body without it.
 */
export function buildSignDoc(input: SignDocInput): AminoSignDoc {
  return {
    chain_id: input.chainId,
    account_number: input.accountNumber,
    sequence: input.sequence,
    fee: {
      amount: input.fee.amount.map((coin) => ({ denom: coin.denom, amount: coin.amount })),
      gas: input.fee.gas,
      ...(input.fee.granter ? { granter: input.fee.granter } : {}),
      ...(input.fee.payer ? { payer: input.fee.payer } : {})
    },
    memo: input.memo,
    msgs: input.msgs
  }
}

/** Exactly the bytes a wallet signs. */
export function signBytes(doc: AminoSignDoc): Uint8Array {
  return serializeSignDoc(doc)
}

/**
 * What a signature is actually over: sha256 of the serialised document.
 *
 * Carried alongside every collected signature so that a bundle which was
 * signed against some *other* document is caught as a mismatch — an explicit
 * "this signature is for a different transaction" rather than a silent
 * verification failure at broadcast time, when a round of signing has already
 * been spent.
 */
export function signBytesHash(doc: AminoSignDoc): string {
  return toHex(sha256(signBytes(doc)))
}

/**
 * Whether two documents are the same document.
 *
 * Compared by their serialised bytes, not field by field: the serialisation is
 * what gets signed, so it is the only definition of sameness that matters, and
 * it is immune to key order and to fields that JSON round-tripping moved
 * about.
 */
export function docsEqual(a: AminoSignDoc, b: AminoSignDoc): boolean {
  const left = signBytes(a)
  const right = signBytes(b)
  if (left.length !== right.length) return false
  // Length-equal documents are compared in full; there is no secret here to
  // leak by returning early, only a mismatch to report.
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return false
  }
  return true
}

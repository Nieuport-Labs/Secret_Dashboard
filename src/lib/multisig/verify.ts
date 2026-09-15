/**
 * Everything checked before a member is allowed to sign.
 *
 * The checklist is the feature. A multisig where signing is one click and a
 * hope is worse than no multisig at all, because it spreads the responsibility
 * for a transaction across people who could not actually inspect it — and on
 * Secret, where a contract call is encrypted, "could not actually inspect it"
 * is the default rather than the exception.
 *
 * So every check here is reported individually rather than collapsed into a
 * verdict. A member should be able to see *which* thing is true: that the
 * account is the one they think it is, that the message decrypts to what the
 * proposal says, that the code hash is the contract's real one, that the
 * sequence has not already been spent. A single green tick would hide all of
 * that, and a single red cross would be unactionable.
 *
 * Checks fail closed. Anything that could not be established — because a node
 * was unreachable, say — is a failure and not a pass, since "I could not check"
 * and "it is fine" are the two things a signing screen must never confuse.
 */

import { Secp256k1, Secp256k1Signature, sha256 } from '@cosmjs/crypto'
import { fromBase64, toHex } from '@cosmjs/encoding'
import type { SecretNetworkClient } from 'secretjs'

import { BECH32_PREFIX, DENOM, GAS_PRICE_USCRT } from '@/chains/secret4'
import { queryNativeBalance } from '@/lib/bank'
import { isValidBech32 } from '@/lib/bech32'
import { codeHashFor } from '@/lib/codeHash'
import { errorMessage } from '@/lib/errors'
import { checkUsable, fetchFeeGrants } from '@/lib/feegrant-sdk'
import { fetchAccountMeta } from '@/lib/multisig/account'
import type { Proposal, SignatureBundle } from '@/lib/multisig/bundle'
import { addressForPubkey, fingerprintOf, isMember, type MultisigConfig } from '@/lib/multisig/config'
import { verifyCiphertext } from '@/lib/multisig/encryption'
import { computeEntries, foreignSigners, typeUrlsFor, CHAIN_REFUSES } from '@/lib/multisig/messages'
import { buildSignDoc, signBytes, signBytesHash, type SignDocInput } from '@/lib/multisig/signdoc'
import type { AminoSignDoc } from '@/lib/wallet'

export type CheckStatus = 'pass' | 'warn' | 'fail'

export interface Check {
  /** Stable across runs, so the UI can key rows and tests can name them. */
  id: string
  label: string
  status: CheckStatus
  detail?: string
}

export interface VerifyInput {
  config: MultisigConfig
  proposal: Proposal
  /** Read-only is enough; nothing here signs. */
  client: SecretNetworkClient
  lcdUrl: string
  /** The rebuilt document, from `rebuildSignDoc`. Absent when rebuilding failed. */
  doc?: AminoSignDoc
}

export interface Verification {
  checks: Check[]
  /** No check failed. Warnings still stand and the UI asks about them. */
  signable: boolean
  warnings: Check[]
}

function pass(id: string, label: string, detail?: string): Check {
  return { id, label, status: 'pass', detail }
}
function warn(id: string, label: string, detail: string): Check {
  return { id, label, status: 'warn', detail }
}
function fail(id: string, label: string, detail: string): Check {
  return { id, label, status: 'fail', detail }
}

/* -------------------------------------------------------------------------- */
/* The document                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The sign doc for a proposal, from its own fields.
 *
 * Every member does this for themselves — it is the reason a proposal carries
 * no document of its own. Amino messages come from the caller, because
 * producing them needs secretjs and the verified ciphertexts; see
 * `flow.ts`.
 */
export function buildDocFor(proposal: Proposal, msgs: Array<{ type: string; value: unknown }>): AminoSignDoc {
  const input: SignDocInput = {
    chainId: proposal.chainId,
    accountNumber: proposal.accountNumber,
    sequence: proposal.sequence,
    fee: proposal.fee,
    memo: proposal.memo,
    msgs
  }
  // Through the same helper the proposer used, so there is one definition of
  // the document rather than two that can drift.
  return buildSignDoc(input)
}

/* -------------------------------------------------------------------------- */
/* The checks                                                                  */
/* -------------------------------------------------------------------------- */

/** Which account this is, and whether it is one of ours. */
function checkAccount(config: MultisigConfig, proposal: Proposal): Check[] {
  const checks: Check[] = []

  checks.push(
    proposal.multisig === config.address
      ? pass('account', 'It is for this account', config.address)
      : fail('account', 'It is for a different account', `This proposal spends from ${proposal.multisig}.`)
  )

  const expected = fingerprintOf(config)
  checks.push(
    proposal.fingerprint === expected
      ? pass('members', 'The member set matches', expected)
      : fail(
          'members',
          'The member set does not match',
          `This proposal was written for members ${proposal.fingerprint}, and this account is ${expected}.`
        )
  )

  return checks
}

/** Nobody else's signature is required, and nothing the chain currently refuses. */
function checkMessages(proposal: Proposal): Check[] {
  const checks: Check[] = []

  try {
    const foreign = foreignSigners(proposal.msgs, proposal.multisig)
    checks.push(
      foreign.length === 0
        ? pass('senders', 'Every message acts for this account')
        : fail(
            'senders',
            'A message acts for somebody else',
            `Message ${foreign[0].index + 1} (${foreign[0].template}) would need ${foreign[0].signer} to sign.`
          )
    )
  } catch (error) {
    checks.push(fail('senders', 'A message cannot be checked', errorMessage(error)))
  }

  const refused = proposal.msgs.filter((message) => CHAIN_REFUSES.has(message.template))
  if (refused.length > 0) {
    checks.push(
      fail(
        'chain-refuses',
        'The chain will not accept this',
        `${refused[0].template} is disabled chain-wide, so this transaction would fail however many members sign it.`
      )
    )
  }

  return checks
}

/** What the encrypted parts really say, and which contract they are really for. */
async function checkCiphertexts(input: VerifyInput): Promise<Check[]> {
  const { proposal } = input
  const entries = computeEntries(proposal.msgs)
  if (entries.length === 0) return []

  const checks: Check[] = []

  if (!proposal.seed) {
    return [
      fail(
        'ciphertext',
        'The encrypted messages cannot be read',
        'This proposal carries no key to check them with.'
      )
    ]
  }
  const seed = fromBase64(proposal.seed)

  for (const entry of entries) {
    const label = `Message ${entry.index + 1} says what it claims`

    if (!/^[0-9a-fA-F]{64}$/.test(entry.codeHash)) {
      checks.push(fail(`ciphertext-${entry.index}`, label, 'It names no contract code to be encrypted to.'))
      continue
    }
    if (!isValidBech32(entry.contractAddress, BECH32_PREFIX)) {
      checks.push(fail(`ciphertext-${entry.index}`, label, 'It names no valid contract address.'))
      continue
    }
    if (!entry.ciphertext) {
      checks.push(fail(`ciphertext-${entry.index}`, label, 'It carries no encrypted body.'))
      continue
    }

    const verdict = await verifyCiphertext({
      lcdUrl: input.lcdUrl,
      seed,
      ciphertext: fromBase64(entry.ciphertext),
      declaredCodeHash: entry.codeHash,
      declaredMsg: entry.msg
    })

    if (verdict.status === 'mismatch') {
      checks.push(fail(`ciphertext-${entry.index}`, label, verdict.reason))
      continue
    }
    checks.push(
      verdict.status === 'exact'
        ? pass(`ciphertext-${entry.index}`, label)
        : warn(`ciphertext-${entry.index}`, label, verdict.detail)
    )

    // The code hash the proposal pinned has to be the one the contract
    // actually runs, or the message is encrypted to code nobody asked about.
    try {
      const onChain = await codeHashFor(input.client, entry.contractAddress)
      checks.push(
        onChain.toLowerCase() === entry.codeHash.toLowerCase()
          ? pass(`code-hash-${entry.index}`, `Message ${entry.index + 1} targets the contract it names`)
          : fail(
              `code-hash-${entry.index}`,
              `Message ${entry.index + 1} targets the contract it names`,
              `${entry.contractAddress} runs code ${onChain.slice(0, 12)}…, but this message is encrypted to ${entry.codeHash.slice(0, 12)}….`
            )
      )
    } catch (error) {
      checks.push(
        fail(
          `code-hash-${entry.index}`,
          `Message ${entry.index + 1} targets the contract it names`,
          `The contract could not be read from the chain: ${errorMessage(error)}`
        )
      )
    }
  }

  return checks
}

/**
 * The account number and sequence, against the chain.
 *
 * Both are signed, so both are fixed at compose time. A sequence the account
 * has already moved past cannot be recovered — the signatures are void and the
 * proposal has to be made again — and saying so plainly is the difference
 * between one wasted round and three.
 */
async function checkSequence(input: VerifyInput): Promise<Check[]> {
  const { proposal } = input

  let account: Awaited<ReturnType<typeof fetchAccountMeta>>
  try {
    account = await fetchAccountMeta(input.client, proposal.multisig)
  } catch (error) {
    return [
      fail('sequence', 'The account is current', `The chain could not be asked: ${errorMessage(error)}`)
    ]
  }

  if (!account) {
    return [
      fail(
        'sequence',
        'The account exists on chain',
        'This account has never been funded, so the chain has no record of it and nothing it signs can be broadcast yet.'
      )
    ]
  }

  const checks: Check[] = []
  checks.push(
    account.accountNumber === proposal.accountNumber
      ? pass('account-number', 'The account number matches', proposal.accountNumber)
      : fail(
          'account-number',
          'The account number matches',
          `The chain says ${account.accountNumber}, this proposal says ${proposal.accountNumber}.`
        )
  )

  const current = account.sequence
  if (current === proposal.sequence) {
    checks.push(pass('sequence', 'The sequence is the next one', current))
  } else if (BigInt(proposal.sequence) > BigInt(current)) {
    checks.push(
      warn(
        'sequence',
        'The sequence is the next one',
        `This proposal is queued behind another: the account is at ${current} and this signs for ${proposal.sequence}. It can only be broadcast after that one.`
      )
    )
  } else {
    checks.push(
      fail(
        'sequence',
        'The sequence is the next one',
        `Already spent: the account has moved on to ${current}. Signatures for ${proposal.sequence} can never be broadcast — the proposal has to be made again.`
      )
    )
  }

  return checks
}

/** Who pays, and whether they can. */
async function checkFee(input: VerifyInput): Promise<Check[]> {
  const { proposal } = input
  const fee = proposal.fee.amount.reduce(
    (total, coin) => (coin.denom === DENOM ? total + BigInt(coin.amount) : total),
    0n
  )

  const minimum = BigInt(Math.ceil(Number(proposal.fee.gas) * GAS_PRICE_USCRT))
  const checks: Check[] = []

  if (fee * 8n < minimum) {
    // Well under what this app would ever offer: likely to be rejected by a
    // validator's own minimum, and a rejection here costs the round.
    checks.push(
      warn(
        'fee-size',
        'The fee covers the gas',
        `${fee} ${DENOM} for ${proposal.fee.gas} gas is below what most validators accept.`
      )
    )
  }

  if (proposal.fee.granter) {
    try {
      const grants = await fetchFeeGrants(input.lcdUrl, proposal.multisig)
      const grant = grants.find((candidate) => candidate.granter === proposal.fee.granter)
      if (!grant) {
        checks.push(
          fail(
            'fee-granter',
            'The fee payer can pay',
            `${proposal.fee.granter} has no fee grant to this account, so the transaction would be rejected.`
          )
        )
      } else {
        const unusable = checkUsable(grant, { fee, msgTypeUrls: typeUrlsFor(proposal.msgs) })
        checks.push(
          unusable
            ? fail(
                'fee-granter',
                'The fee payer can pay',
                `The grant from ${proposal.fee.granter} is ${unusable}.`
              )
            : pass('fee-granter', 'The fee payer can pay', proposal.fee.granter)
        )
      }
    } catch (error) {
      checks.push(
        fail('fee-granter', 'The fee payer can pay', `The grant could not be read: ${errorMessage(error)}`)
      )
    }
    return checks
  }

  try {
    const balance = BigInt(await queryNativeBalance(input.client, proposal.multisig))
    checks.push(
      balance >= fee
        ? pass('fee-funds', 'The account can pay the fee')
        : fail(
            'fee-funds',
            'The account can pay the fee',
            `The fee is ${fee} ${DENOM} and the account holds ${balance}.`
          )
    )
  } catch (error) {
    checks.push(
      warn(
        'fee-funds',
        'The account can pay the fee',
        `The balance could not be read: ${errorMessage(error)}`
      )
    )
  }

  return checks
}

/**
 * Every check, in the order a person would want to ask them.
 *
 * The rebuilt document is passed in rather than built here: producing it needs
 * secretjs and the verified ciphertexts, and this module stays free of both so
 * that it can be reasoned about — and tested — on its own.
 */
export async function verifyProposal(input: VerifyInput): Promise<Verification> {
  const checks: Check[] = [...checkAccount(input.config, input.proposal), ...checkMessages(input.proposal)]

  checks.push(
    input.doc
      ? pass('rebuild', 'The transaction was rebuilt here, not taken on trust')
      : fail(
          'rebuild',
          'The transaction was rebuilt here, not taken on trust',
          'It could not be rebuilt from this proposal.'
        )
  )

  checks.push(...(await checkCiphertexts(input)))
  checks.push(...(await checkSequence(input)))
  checks.push(...(await checkFee(input)))

  return {
    checks,
    signable: checks.every((check) => check.status !== 'fail'),
    warnings: checks.filter((check) => check.status === 'warn')
  }
}

/* -------------------------------------------------------------------------- */
/* Signatures                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Whether a signature is what it says it is.
 *
 * Verified locally against our own rebuilt document rather than believed
 * because it arrived. Three things have to hold: the key belongs to a member,
 * the document it was made over is ours, and the mathematics works out. The
 * middle one is why bundles carry the document hash — a signature made against
 * a different document can then be reported as exactly that, instead of
 * surfacing as an inexplicable rejection at broadcast.
 */
export async function verifySignature(params: {
  config: MultisigConfig
  doc: AminoSignDoc
  bundle: SignatureBundle
}): Promise<Check> {
  const { config, doc, bundle } = params
  const id = `signature-${bundle.pubkey.slice(0, 8)}`

  let signer: string
  try {
    signer = addressForPubkey(bundle.pubkey)
  } catch (error) {
    return fail(id, 'Signature', errorMessage(error))
  }

  const label = `Signature from ${signer}`

  if (!isMember(config, signer)) {
    return fail(
      id,
      label,
      `${signer} is not a member of this account, so this signature is worth nothing here.`
    )
  }

  const expected = signBytesHash(doc)
  if (bundle.signBytesHash !== expected) {
    return fail(id, label, 'It was made over a different transaction than the one in front of you.')
  }

  try {
    const valid = await Secp256k1.verifySignature(
      Secp256k1Signature.fromFixedLength(fromBase64(bundle.signature)),
      sha256(signBytes(doc)),
      fromBase64(bundle.pubkey)
    )
    return valid
      ? pass(id, label)
      : fail(id, label, 'The signature does not verify against this transaction.')
  } catch (error) {
    return fail(id, label, `The signature could not be checked: ${errorMessage(error)}`)
  }
}

export interface CollectedSignatures {
  checks: Check[]
  /** Only the ones that verified — the only ones that may be assembled. */
  usable: SignatureBundle[]
  /** Signatures by member address, ready for `assembleTx`. */
  byMember: Map<string, Uint8Array>
  enough: boolean
}

/**
 * Check a whole tray of signatures at once.
 *
 * Duplicates from one member are kept once: a member who signs twice — two
 * devices, an import of their own bundle — has still signed once, and counting
 * them twice would make a 2-of-3 look satisfied by one person.
 */
export async function verifyCollected(params: {
  config: MultisigConfig
  doc: AminoSignDoc
  bundles: SignatureBundle[]
}): Promise<CollectedSignatures> {
  const checks: Check[] = []
  const usable: SignatureBundle[] = []
  const byMember = new Map<string, Uint8Array>()

  for (const bundle of params.bundles) {
    const check = await verifySignature({ config: params.config, doc: params.doc, bundle })
    checks.push(check)
    if (check.status !== 'pass') continue

    const signer = addressForPubkey(bundle.pubkey)
    if (byMember.has(signer)) continue

    byMember.set(signer, fromBase64(bundle.signature))
    usable.push(bundle)
  }

  return { checks, usable, byMember, enough: byMember.size >= params.config.threshold }
}

/** For displaying what a member is about to sign, beside the checks. */
export function documentDigest(doc: AminoSignDoc): string {
  return toHex(sha256(signBytes(doc)))
    .slice(0, 16)
    .toUpperCase()
}

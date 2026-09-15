/**
 * What a proposal actually asks for.
 *
 * A proposal does not carry encoded messages. It carries *intent*: which
 * template, and the same JSON a person would have typed into Powertools'
 * composer. Every member rebuilds the messages from that themselves, with
 * `MESSAGE_TEMPLATES` — the same allowlist the composer uses — and lets
 * secretjs do the encoding.
 *
 * Carrying intent rather than bytes is what makes review possible. Bytes can
 * only be compared to other bytes, and a member with nothing to compare
 * against is reduced to trusting the proposer. Intent can be rendered,
 * checked, and rebuilt: if the rebuilt message encodes to the bytes the
 * proposal was signed over, the two agree, and if it does not, nobody signs.
 *
 * The one thing that cannot be rebuilt is the ciphertext of a contract call,
 * because encryption draws a fresh nonce every time. That is what
 * `fixedCiphertextUtils` in `encryption.ts` is for, and why the ciphertext is
 * verified against the declared message before it is ever used.
 *
 * ## The signer check
 *
 * Every message names the account it acts for — `from_address`, `voter`,
 * `sender`, and so on — and the chain requires that account to have signed. A
 * proposal whose message names *somebody else* is asking the group to spend a
 * threshold of signatures on a transaction that cannot execute, or, worse, is
 * a misdirection dressed as a routine transfer. `foreignSigners` finds those
 * before anyone signs.
 */

import { BECH32_PREFIX, GAS } from '@/chains/secret4'
import { reprefix } from '@/lib/bech32'
import { MESSAGE_TEMPLATES, type Secretjs } from '@/lib/messageTemplates'

import type { Msg } from 'secretjs'

/** One message, as a proposal carries it. */
export interface DeclaredMsg {
  /** A key of `MESSAGE_TEMPLATES`. Anything else is refused rather than guessed at. */
  template: string
  /** Exactly what the composer held: the message in the shape a person edits. */
  content: Record<string, unknown>
  /**
   * The encrypted body, base64 — contract calls only.
   *
   * Present because it cannot be reproduced, not because it is trusted: it is
   * checked against `content.msg` and `content.code_hash` before use.
   */
  ciphertext?: string
}

export class UnknownTemplateError extends Error {
  constructor(template: string) {
    super(`This proposal contains a "${template}" message, which this app cannot build or check.`)
    this.name = 'UnknownTemplateError'
  }
}

export function isKnownTemplate(template: string): boolean {
  return Object.prototype.hasOwnProperty.call(MESSAGE_TEMPLATES, template)
}

export function isComputeTemplate(template: string): boolean {
  return template === 'MsgExecuteContract' || template === 'MsgInstantiateContract'
}

/**
 * Messages the chain will not accept from anyone at the moment.
 *
 * `MsgStoreCode` and `MsgInstantiateContract` are disabled chain-wide by the
 * circuit breaker (governance proposal 370). A proposal carrying one is not
 * malformed — it simply cannot succeed — and saying so up front is cheaper
 * than a round of signatures spent on `tx type not allowed`.
 */
export const CHAIN_REFUSES = new Set(['MsgInstantiateContract'])

/* -------------------------------------------------------------------------- */
/* Who acts                                                                    */
/* -------------------------------------------------------------------------- */

const str = (content: Record<string, unknown>, key: string): string => String(content[key] ?? '')

/**
 * A validator address as the account behind it.
 *
 * Throws rather than returning nothing when the address will not parse: a
 * message with no resolvable signer would otherwise sail through the check
 * below with an empty list, which reads as "nobody unexpected signs this"
 * when it means "this cannot be checked at all".
 */
function operatorOf(valoper: string, field: string): string {
  const account = valoper ? reprefix(valoper, BECH32_PREFIX) : undefined
  if (!account)
    throw new UnresolvedSignerError(`${field} is not a validator address this can be checked against.`)
  return account
}

export class UnresolvedSignerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnresolvedSignerError'
  }
}

/**
 * The account(s) a message requires a signature from.
 *
 * Two of these are indirect: withdrawing commission and unjailing name a
 * `secretvaloper1…`, and the account that must sign is the operator behind it
 * — the same key spelled differently.
 */
const SIGNERS: Record<string, (content: Record<string, unknown>) => string[]> = {
  MsgSend: (c) => [str(c, 'from_address')],
  MsgMultiSend: (c) =>
    ((c.inputs as Array<{ address?: string }> | undefined) ?? []).map((input) =>
      String(input?.address ?? '')
    ),
  MsgDelegate: (c) => [str(c, 'delegator_address')],
  MsgUndelegate: (c) => [str(c, 'delegator_address')],
  MsgBeginRedelegate: (c) => [str(c, 'delegator_address')],
  MsgSetAutoRestake: (c) => [str(c, 'delegator_address')],
  MsgWithdrawDelegatorReward: (c) => [str(c, 'delegator_address')],
  MsgSetWithdrawAddress: (c) => [str(c, 'delegator_address')],
  MsgWithdrawValidatorCommission: (c) => [operatorOf(str(c, 'validator_address'), 'validator_address')],
  MsgUnjail: (c) => [operatorOf(str(c, 'validator_addr'), 'validator_addr')],
  MsgFundCommunityPool: (c) => [str(c, 'depositor')],
  MsgExecuteContract: (c) => [str(c, 'sender')],
  MsgInstantiateContract: (c) => [str(c, 'sender')],
  MsgTransfer: (c) => [str(c, 'sender')],
  MsgGrantAllowance: (c) => [str(c, 'granter')],
  MsgRevokeAllowance: (c) => [str(c, 'granter')],
  MsgVote: (c) => [str(c, 'voter')],
  MsgDeposit: (c) => [str(c, 'depositor')]
}

export function signersOf(declared: DeclaredMsg): string[] {
  const extract = SIGNERS[declared.template]
  if (!extract) throw new UnknownTemplateError(declared.template)

  const signers = extract(declared.content)
  // An empty list would read as "nobody unexpected signs this" when it means
  // the message names nobody at all — which the chain rejects, after a round
  // of signatures has been spent on it.
  if (signers.length === 0 || signers.some((signer) => !signer)) {
    throw new UnresolvedSignerError(
      `A ${declared.template} message in this proposal names no account to act for.`
    )
  }
  return signers
}

export interface ForeignSigner {
  index: number
  template: string
  signer: string
}

/** Messages that would need a signature from someone other than this account. */
export function foreignSigners(messages: DeclaredMsg[], account: string): ForeignSigner[] {
  const foreign: ForeignSigner[] = []

  messages.forEach((declared, index) => {
    for (const signer of signersOf(declared)) {
      if (signer !== account) foreign.push({ index, template: declared.template, signer })
    }
  })

  return foreign
}

/* -------------------------------------------------------------------------- */
/* Building                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The messages themselves, rebuilt from intent.
 *
 * `secretjs` is threaded in rather than imported, the same way
 * `messageTemplates.ts` does it: this module has no reason to pull three
 * megabytes into whatever bundle first touches it.
 */
export function buildMsgs(secretjs: Secretjs, messages: DeclaredMsg[]): Msg[] {
  return messages.map((declared) => {
    const template = MESSAGE_TEMPLATES[declared.template]
    if (!template) throw new UnknownTemplateError(declared.template)
    return template.build(secretjs, declared.content)
  })
}

export function typeUrlsFor(messages: DeclaredMsg[]): string[] {
  return messages.map((declared) => {
    const template = MESSAGE_TEMPLATES[declared.template]
    if (!template) throw new UnknownTemplateError(declared.template)
    return template.typeUrl
  })
}

export interface ComputeEntry {
  index: number
  /** Pinned when the proposal was composed, not looked up while reviewing it. */
  codeHash: string
  contractAddress: string
  msg: object
  ciphertext?: string
}

/**
 * The contract calls in a proposal, with what each claims to be.
 *
 * The code hash is read from the message itself rather than carried beside
 * it: it is what the body is encrypted *to*, so keeping one copy means there
 * is nothing for a second copy to disagree with.
 */
export function computeEntries(messages: DeclaredMsg[]): ComputeEntry[] {
  const entries: ComputeEntry[] = []

  messages.forEach((declared, index) => {
    if (declared.template !== 'MsgExecuteContract') return
    entries.push({
      index,
      codeHash: str(declared.content, 'code_hash'),
      contractAddress: str(declared.content, 'contract_address'),
      msg: (declared.content.msg ?? {}) as object,
      ciphertext: declared.ciphertext
    })
  })

  return entries
}

/* -------------------------------------------------------------------------- */
/* Gas                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * A contract call whose cost nobody can ask the chain about.
 *
 * secretjs refuses to simulate `MsgExecuteContract` "for security reasons", so
 * unlike every other screen in this app, a multisig proposal cannot size its
 * own gas. Generous on purpose: a transaction that runs out of gas costs the
 * fee *and* a whole round of signatures, since the signed sequence is spent
 * either way.
 */
const COMPUTE_GAS = 250_000

const PER_TEMPLATE: Record<string, number> = {
  MsgSend: GAS.send,
  MsgDelegate: GAS.delegate,
  MsgUndelegate: GAS.undelegate,
  MsgBeginRedelegate: GAS.redelegate,
  MsgWithdrawDelegatorReward: GAS.claimRewards,
  MsgSetAutoRestake: GAS.setAutoRestake,
  MsgWithdrawValidatorCommission: GAS.withdrawCommission,
  MsgUnjail: GAS.unjail,
  MsgVote: GAS.vote,
  MsgTransfer: GAS.ibcTransfer,
  MsgExecuteContract: COMPUTE_GAS,
  MsgInstantiateContract: COMPUTE_GAS
}

/** Anything the table above does not name, sized the way Powertools sizes it. */
const FALLBACK_GAS = 150_000

/**
 * What a multisig transaction costs beyond its messages.
 *
 * Every member's public key rides in the transaction whether they signed or
 * not, and every signature collected is verified separately, so a 3-of-5 is
 * measurably more expensive than the same messages sent by one account. The
 * figure is a cushion rather than a measurement — the first mainnet
 * transactions will say what it really is — and the composer lets the gas be
 * edited, because an under-gassed proposal is the expensive mistake here.
 */
const PER_MEMBER_GAS = 5_000

export function defaultGasFor(messages: DeclaredMsg[], memberCount: number, threshold: number): number {
  const base = messages.reduce(
    (total, declared) => total + (PER_TEMPLATE[declared.template] ?? FALLBACK_GAS),
    0
  )
  return base + (memberCount + threshold) * PER_MEMBER_GAS
}

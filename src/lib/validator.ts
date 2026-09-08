import type { SecretNetworkClient } from 'secretjs'

import { BECH32_PREFIX, BECH32_VALCONS_PREFIX, BECH32_VALOPER_PREFIX, DENOM } from '@/chains/secret4'
import { encodeBech32, reprefix } from '@/lib/bech32'
import { parseTimestamp } from '@/lib/feegrant-sdk'
import { toValidator, type Validator } from '@/lib/staking'

/**
 * A validator seen from the inside — what its operator needs, rather than what
 * a delegator shopping for one needs.
 *
 * `lib/staking.ts` already covers the delegator's view and is left alone; this
 * adds the fields only an operator asks about (the commission ceiling they are
 * bound by, their signing record, the commission waiting to be withdrawn) and
 * the three messages that change any of it.
 */

/* -------------------------------------------------------------------------- */
/* Addresses                                                                   */
/* -------------------------------------------------------------------------- */

/** The validator address for an account — `secret1…` → `secretvaloper1…`. */
export function toValoper(address: string): string | undefined {
  return reprefix(address, BECH32_VALOPER_PREFIX)
}

/** The self-delegating account behind a validator. Verified against secret-4. */
export function toOperatorAddress(valoper: string): string | undefined {
  return reprefix(valoper, BECH32_PREFIX)
}

/**
 * The consensus address, which is the only key the slashing module answers to.
 *
 * Not derivable from the operator address — it is the hash of the validator's
 * consensus public key, a different key entirely — so the pubkey has to come
 * from the staking record first. Tendermint defines an ed25519 address as the
 * leading 20 bytes of its SHA-256, which is what this is.
 */
export async function toConsensusAddress(pubkeyBase64: string): Promise<string | undefined> {
  try {
    const raw = Uint8Array.from(atob(pubkeyBase64), (character) => character.charCodeAt(0))
    const digest = await crypto.subtle.digest('SHA-256', raw)
    return encodeBech32(BECH32_VALCONS_PREFIX, new Uint8Array(digest).slice(0, 20))
  } catch {
    return undefined
  }
}

/* -------------------------------------------------------------------------- */
/* Queries                                                                     */
/* -------------------------------------------------------------------------- */

export interface ValidatorDetail extends Validator {
  /** The rate this validator may never exceed, fixed at creation. */
  maxRate: number
  /** How much the rate may move in a single day. */
  maxChangeRate: number
  /**
   * When the rate last moved. The chain refuses a second change within 24
   * hours of it, so it is the difference between an editable field and one
   * that will be rejected.
   */
  commissionUpdatedAt?: Date
  minSelfDelegation: string
  /** Base64 ed25519 key, for deriving the consensus address. */
  consensusKey?: string
}

export async function queryValidatorDetail(
  client: SecretNetworkClient,
  valoper: string
): Promise<ValidatorDetail | undefined> {
  const response = await client.query.staking.validator({ validator_addr: valoper })
  const raw = response.validator
  if (!raw) return undefined

  const rates = raw.commission?.commission_rates
  return {
    ...toValidator(raw),
    maxRate: Number(rates?.max_rate ?? '0'),
    maxChangeRate: Number(rates?.max_change_rate ?? '0'),
    commissionUpdatedAt: parseTimestamp(raw.commission?.update_time),
    minSelfDelegation: raw.min_self_delegation ?? '0',
    consensusKey: (raw.consensus_pubkey as { key?: string } | undefined)?.key
  }
}

export interface SigningRecord {
  /** Blocks missed inside the window the chain judges downtime over. */
  missedBlocks: number
  signedBlocksWindow: number
  /** Jailed until this moment; in the past once the jailing has expired. */
  jailedUntil?: Date
  /** Permanently barred for double-signing. No unjail will lift it. */
  tombstoned: boolean
}

/**
 * The signing record the chain would jail this validator on.
 *
 * Returns `undefined` rather than zeroes when it cannot be read: a validator
 * shown "0 missed" because a query failed is being told it is healthy on no
 * evidence, and that is the one wrong answer this screen must not give.
 */
export async function querySigningRecord(
  client: SecretNetworkClient,
  consensusKey: string | undefined
): Promise<SigningRecord | undefined> {
  if (!consensusKey) return undefined
  const consAddress = await toConsensusAddress(consensusKey)
  if (!consAddress) return undefined

  try {
    const [info, params] = await Promise.all([
      client.query.slashing.signingInfo({ cons_address: consAddress }),
      client.query.slashing.params({})
    ])
    const record = info.val_signing_info
    if (!record) return undefined

    return {
      missedBlocks: Number(record.missed_blocks_counter ?? '0'),
      signedBlocksWindow: Number(params.params?.signed_blocks_window ?? '0'),
      jailedUntil: parseTimestamp(record.jailed_until),
      tombstoned: Boolean(record.tombstoned)
    }
  } catch {
    return undefined
  }
}

/** What the operator has staked on itself, in base units. */
export async function querySelfDelegation(client: SecretNetworkClient, valoper: string): Promise<string> {
  const operator = toOperatorAddress(valoper)
  if (!operator) return '0'
  try {
    const response = await client.query.staking.delegation({
      delegator_addr: operator,
      validator_addr: valoper
    })
    return response.delegation_response?.balance?.amount ?? '0'
  } catch {
    // A validator that never self-delegated, or has since undelegated in full,
    // answers 404 here rather than with a zero balance.
    return '0'
  }
}

export async function queryDelegatorCount(
  client: SecretNetworkClient,
  valoper: string
): Promise<number | undefined> {
  try {
    const response = await client.query.staking.validatorDelegations({
      validator_addr: valoper,
      // One row is enough — the count is what is wanted, and asking for three
      // thousand delegations to count them is a megabyte for one number.
      pagination: { limit: '1', count_total: true }
    })
    const total = Number(response.pagination?.total ?? '')
    return Number.isFinite(total) ? total : undefined
  } catch {
    return undefined
  }
}

/**
 * Commission earned and not yet withdrawn, in base units of SCRT.
 *
 * The chain pays commission in every denom the validator collected fees in, so
 * this deliberately picks out SCRT alone; the rest is a rounding footnote that
 * a headline figure cannot honestly add up. Truncated, not rounded — the same
 * reason as the delegator rewards in `lib/staking.ts`.
 */
export async function queryOutstandingCommission(
  client: SecretNetworkClient,
  valoper: string
): Promise<string> {
  try {
    const response = await client.query.distribution.validatorCommission({ validator_address: valoper })
    const coin = response.commission?.commission?.find((c) => c.denom === DENOM)
    return coin?.amount ? coin.amount.split('.')[0] : '0'
  } catch {
    return '0'
  }
}

/* -------------------------------------------------------------------------- */
/* Messages                                                                    */
/* -------------------------------------------------------------------------- */

export async function validatorMessages() {
  const { MsgEditValidator, MsgWithdrawValidatorCommission, MsgUnjail } = await import('secretjs')
  return { MsgEditValidator, MsgWithdrawValidatorCommission, MsgUnjail }
}

export interface DescriptionEdit {
  moniker: string
  identity: string
  website: string
  details: string
}

/**
 * `MsgEditValidator` treats the sentinel `[do-not-modify]` as "leave this
 * alone", and an empty string as "clear this field". Sending a description at
 * all rewrites every field in it, so anything the form did not change has to be
 * sent back unchanged — which is what this builds.
 */
export async function editValidatorMessage(
  valoper: string,
  description: DescriptionEdit,
  commissionRate?: number
) {
  const { MsgEditValidator } = await validatorMessages()
  return new MsgEditValidator({
    validator_address: valoper,
    description: { ...description, security_contact: '[do-not-modify]' },
    // Omitted entirely when unchanged: sending the current rate still counts as
    // a change against the chain's once-a-day limit.
    commission_rate: commissionRate
  })
}

export async function withdrawCommissionMessage(valoper: string) {
  const { MsgWithdrawValidatorCommission } = await validatorMessages()
  return new MsgWithdrawValidatorCommission({ validator_address: valoper })
}

export async function unjailMessage(valoper: string) {
  const { MsgUnjail } = await validatorMessages()
  return new MsgUnjail({ validator_addr: valoper })
}

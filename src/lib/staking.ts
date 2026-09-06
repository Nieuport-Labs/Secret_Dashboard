import type { SecretNetworkClient } from 'secretjs'

import { DENOM } from '@/chains/secret4'
import { parseTimestamp } from '@/lib/feegrant-sdk'

/**
 * Staking, rewards, and Secret's own auto-restake.
 *
 * Auto-restake is not a standard Cosmos feature. Secret adds
 * `MsgSetAutoRestake` to `x/distribution`, and the chain compounds rewards for
 * you rather than a bot doing it. It has a floor — below a threshold the chain
 * publishes, enabling it for a validator does nothing at all — which is why the
 * threshold is read here rather than assumed.
 */

export interface Validator {
  address: string
  moniker: string
  /** Commission as a fraction, e.g. 0.05. */
  commission: number
  /** Voting power in base units. */
  tokens: string
  jailed: boolean
  status: string
  website?: string
  details?: string
  identity?: string
}

export interface Delegation {
  validatorAddress: string
  /** Base units. */
  amount: string
}

export interface Reward {
  validatorAddress: string
  /** Base units, truncated from the chain's decimal string. */
  amount: string
}

export interface Unbonding {
  validatorAddress: string
  amount: string
  completesAt: Date
}

/* -------------------------------------------------------------------------- */
/* Queries                                                                     */
/* -------------------------------------------------------------------------- */

function toValidator(v: {
  operator_address?: string
  description?: { moniker?: string; website?: string; details?: string; identity?: string }
  commission?: { commission_rates?: { rate?: string } }
  tokens?: string
  jailed?: boolean
  status?: string
}): Validator {
  return {
    address: v.operator_address ?? '',
    moniker: v.description?.moniker ?? 'Unnamed validator',
    commission: Number(v.commission?.commission_rates?.rate ?? '0'),
    tokens: v.tokens ?? '0',
    jailed: Boolean(v.jailed),
    status: v.status ?? '',
    website: v.description?.website || undefined,
    details: v.description?.details || undefined,
    identity: v.description?.identity || undefined
  }
}

/**
 * One validator by address, whatever its bonding status.
 *
 * Needed because a delegation survives its validator leaving the active set. If
 * only bonded validators were listed, a stake with one that got jailed or
 * unbonded would vanish from the screen while still existing on chain — and
 * that is exactly the delegation someone most needs to find and move.
 */
export async function queryValidator(
  client: SecretNetworkClient,
  address: string
): Promise<Validator | undefined> {
  try {
    const response = await client.query.staking.validator({ validator_addr: address })
    return response.validator ? toValidator(response.validator) : undefined
  } catch {
    return undefined
  }
}

export async function queryValidators(client: SecretNetworkClient): Promise<Validator[]> {
  const response = await client.query.staking.validators({
    status: 'BOND_STATUS_BONDED',
    pagination: { limit: '300' }
  })

  return (
    (response.validators ?? [])
      .map(toValidator)
      .filter((v) => v.address)
      // Most voting power first, which is also the order that makes the long tail
      // visible rather than hiding it behind whoever registered first.
      .sort((a, b) => (BigInt(b.tokens) > BigInt(a.tokens) ? 1 : -1))
  )
}

export async function queryDelegations(
  client: SecretNetworkClient,
  delegator: string
): Promise<Delegation[]> {
  const response = await client.query.staking.delegatorDelegations({
    delegator_addr: delegator,
    pagination: { limit: '300' }
  })

  return (response.delegation_responses ?? [])
    .map((d) => ({
      validatorAddress: d.delegation?.validator_address ?? '',
      amount: d.balance?.amount ?? '0'
    }))
    .filter((d) => d.validatorAddress && d.amount !== '0')
}

/**
 * Pending rewards, per validator.
 *
 * The chain returns these as decimal strings with 18 places — `123.456…` uscrt.
 * Truncating rather than rounding matters: rounding up produces a figure the
 * user cannot actually claim.
 */
export async function queryRewards(client: SecretNetworkClient, delegator: string): Promise<Reward[]> {
  const response = await client.query.distribution.delegationTotalRewards({
    delegator_address: delegator
  })

  return (response.rewards ?? [])
    .map((entry) => {
      const coin = entry.reward?.find((c) => c.denom === DENOM)
      return {
        validatorAddress: entry.validator_address ?? '',
        amount: coin?.amount ? coin.amount.split('.')[0] : '0'
      }
    })
    .filter((r) => r.validatorAddress && r.amount !== '0')
}

export async function queryUnbondings(client: SecretNetworkClient, delegator: string): Promise<Unbonding[]> {
  const response = await client.query.staking.delegatorUnbondingDelegations({
    delegator_addr: delegator,
    pagination: { limit: '100' }
  })

  const rows: Unbonding[] = []
  for (const entry of response.unbonding_responses ?? []) {
    for (const item of entry.entries ?? []) {
      rows.push({
        validatorAddress: entry.validator_address ?? '',
        amount: item.balance ?? '0',
        // `completion_time` arrives as RFC 3339 from one node's marshaller and
        // as `{seconds, nanos}` from another's. The fee-grant SDK already has
        // the parser that takes both, so it is reused rather than rewritten.
        completesAt: parseTimestamp(item.completion_time) ?? new Date()
      })
    }
  }
  return rows
}

/** Validators this delegator has auto-restake switched on for. */
export async function queryRestakeEntries(client: SecretNetworkClient, delegator: string): Promise<string[]> {
  const response = await client.query.distribution.restakingEntries({ delegator })
  return response.validators ?? []
}

/**
 * The minimum delegation the chain will auto-restake, in base units.
 *
 * Read, not hardcoded. Below it the message is accepted and then does nothing,
 * so a UI that does not know the number offers a switch that silently fails.
 */
export async function queryRestakeThreshold(client: SecretNetworkClient): Promise<string> {
  const response = await client.query.distribution.restakeThreshold({})
  // Returned as a decimal string, like the rewards.
  return (response.threshold ?? '0').split('.')[0]
}

/** How long an undelegation takes to unlock. */
export async function queryUnbondingSeconds(client: SecretNetworkClient): Promise<number> {
  const response = await client.query.staking.params({})
  const raw = response.params?.unbonding_time ?? '0s'
  return Number(String(raw).replace(/s$/, '')) || 0
}

/* -------------------------------------------------------------------------- */
/* Messages                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Every staking message this app sends.
 *
 * Built here rather than in components so a screen cannot accidentally send one
 * without the fee-payer treatment every transaction gets.
 */
export async function stakingMessages() {
  const { MsgDelegate, MsgUndelegate, MsgBeginRedelegate, MsgWithdrawDelegatorReward, MsgSetAutoRestake } =
    await import('secretjs')
  return { MsgDelegate, MsgUndelegate, MsgBeginRedelegate, MsgWithdrawDelegatorReward, MsgSetAutoRestake }
}

export function coin(amount: string) {
  return { amount, denom: DENOM }
}

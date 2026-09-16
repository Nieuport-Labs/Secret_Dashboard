/**
 * Turning what a person chose into the messages a proposal carries.
 *
 * The composer's forms ask for the things a person actually knows — an amount
 * in SCRT, a validator, a recipient — and this is where those become the shape
 * the chain wants: base units, a denomination glued to the figure, the right
 * field names for each message type.
 *
 * Separate from the forms on purpose. Every function here is a pure mapping
 * with no React in it, which is what lets the composer preview a proposal with
 * exactly the machinery that will describe it to the people reviewing it, and
 * what makes the conversions checkable in a script instead of by clicking.
 *
 * Amounts are the part worth being careful about. A person types `10`; the
 * chain wants `10000000`; a missing factor of ten in either direction is a
 * mistake nobody notices in a JSON blob. `toBaseUnits` is the app's own
 * conversion, the same one the wallet's send form uses.
 */

import { DENOM } from '@/chains/secret4'
import { toBaseUnits } from '@/lib/format'
import type { DeclaredMsg } from '@/lib/multisig/messages'
import { tokenByAddress } from '@/tokens/registry'

/** `"10"` as `"10000000uscrt"` — a figure and its denomination, as the templates want it. */
function nativeCoin(amount: string, denom: string = DENOM, decimals = 6): string {
  return `${toBaseUnits(amount, decimals)}${denom}`
}

function tokenUnits(amount: string, contract: string): string {
  const token = tokenByAddress(contract)
  return toBaseUnits(amount, token?.decimals ?? 6)
}

/* -------------------------------------------------------------------------- */
/* Moving value                                                                */
/* -------------------------------------------------------------------------- */

export function sendNative(params: {
  from: string
  to: string
  amount: string
  denom?: string
}): DeclaredMsg {
  return {
    template: 'MsgSend',
    content: {
      from_address: params.from,
      to_address: params.to.trim(),
      amount: nativeCoin(params.amount, params.denom)
    }
  }
}

export function sendToken(params: {
  from: string
  to: string
  contract: string
  amount: string
}): DeclaredMsg {
  return {
    template: 'MsgExecuteContract',
    content: {
      sender: params.from,
      contract_address: params.contract,
      code_hash: '',
      msg: { transfer: { recipient: params.to.trim(), amount: tokenUnits(params.amount, params.contract) } },
      sent_funds: ''
    }
  }
}

/**
 * Wrapping sends the coins along with the call, as `sent_funds` — the contract
 * mints against what it receives rather than against a figure in the message.
 */
export function wrap(params: { from: string; contract: string; amount: string }): DeclaredMsg {
  return {
    template: 'MsgExecuteContract',
    content: {
      sender: params.from,
      contract_address: params.contract,
      code_hash: '',
      msg: { deposit: {} },
      sent_funds: nativeCoin(params.amount)
    }
  }
}

export function unwrap(params: { from: string; contract: string; amount: string }): DeclaredMsg {
  return {
    template: 'MsgExecuteContract',
    content: {
      sender: params.from,
      contract_address: params.contract,
      code_hash: '',
      msg: { redeem: { amount: tokenUnits(params.amount, params.contract) } },
      sent_funds: ''
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Staking                                                                     */
/* -------------------------------------------------------------------------- */

export function stake(params: { delegator: string; validator: string; amount: string }): DeclaredMsg {
  return {
    template: 'MsgDelegate',
    content: {
      delegator_address: params.delegator,
      validator_address: params.validator,
      amount: nativeCoin(params.amount)
    }
  }
}

export function unstake(params: { delegator: string; validator: string; amount: string }): DeclaredMsg {
  return {
    template: 'MsgUndelegate',
    content: {
      delegator_address: params.delegator,
      validator_address: params.validator,
      amount: nativeCoin(params.amount)
    }
  }
}

export function redelegate(params: {
  delegator: string
  from: string
  to: string
  amount: string
}): DeclaredMsg {
  return {
    template: 'MsgBeginRedelegate',
    content: {
      delegator_address: params.delegator,
      validator_src_address: params.from,
      validator_dst_address: params.to,
      amount: nativeCoin(params.amount)
    }
  }
}

/**
 * Claiming is one message per validator, because the chain has no "claim
 * everything" message — the wallet's own claim button sends a batch too.
 */
export function claimRewards(params: { delegator: string; validators: string[] }): DeclaredMsg[] {
  return params.validators.map((validator) => ({
    template: 'MsgWithdrawDelegatorReward',
    content: { delegator_address: params.delegator, validator_address: validator }
  }))
}

/* -------------------------------------------------------------------------- */
/* Governance                                                                  */
/* -------------------------------------------------------------------------- */

export function vote(params: { voter: string; proposalId: string; option: string }): DeclaredMsg {
  return {
    template: 'MsgVote',
    content: {
      voter: params.voter,
      proposal_id: params.proposalId.trim(),
      option: params.option,
      metadata: ''
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Reading, and paying                                                         */
/* -------------------------------------------------------------------------- */

/**
 * One key, set at every token the group wants to be able to read.
 *
 * The same key everywhere rather than one per contract: that is what wallets
 * do, it is what makes rotation a single decision, and the alternative is a
 * dozen secrets to keep track of for no gain — they are all readable by the
 * same people anyway.
 */
export function setViewingKey(params: { account: string; contracts: string[]; key: string }): DeclaredMsg[] {
  return params.contracts.map((contract) => ({
    template: 'MsgExecuteContract',
    content: {
      sender: params.account,
      contract_address: contract,
      code_hash: '',
      msg: { set_viewing_key: { key: params.key } },
      sent_funds: ''
    }
  }))
}

export function grantFeeAllowance(params: {
  granter: string
  grantee: string
  /** Human figure in SCRT. Empty means no limit, which is worth being asked about. */
  limit?: string
  /** Unix seconds. */
  expiresAt?: number
}): DeclaredMsg {
  const allowance: Record<string, unknown> = {}
  if (params.limit) allowance.spend_limit = nativeCoin(params.limit)
  if (params.expiresAt) allowance.expiration = { seconds: String(params.expiresAt), nanos: 0 }

  return {
    template: 'MsgGrantAllowance',
    content: { granter: params.granter, grantee: params.grantee.trim(), allowance }
  }
}

export function revokeFeeAllowance(params: { granter: string; grantee: string }): DeclaredMsg {
  return {
    template: 'MsgRevokeAllowance',
    content: { granter: params.granter, grantee: params.grantee.trim() }
  }
}

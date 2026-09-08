/**
 * Message type URLs.
 *
 * These are not decoration. `AllowedMsgAllowance` restricts a fee grant to
 * certain message types, so the grant selector checks them before choosing a
 * granter. Passing the wrong ones, or none, means a grant is picked that the
 * chain then refuses at execution.
 */

export const MSG_SEND = '/cosmos.bank.v1beta1.MsgSend'
export const MSG_EXECUTE_CONTRACT = '/secret.compute.v1beta1.MsgExecuteContract'
export const MSG_TRANSFER = '/ibc.applications.transfer.v1.MsgTransfer'
export const MSG_DELEGATE = '/cosmos.staking.v1beta1.MsgDelegate'
export const MSG_UNDELEGATE = '/cosmos.staking.v1beta1.MsgUndelegate'
export const MSG_BEGIN_REDELEGATE = '/cosmos.staking.v1beta1.MsgBeginRedelegate'
export const MSG_WITHDRAW_REWARD = '/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward'
export const MSG_SET_AUTO_RESTAKE = '/cosmos.distribution.v1beta1.MsgSetAutoRestake'
/** Governance runs on x/gov **v1** here, not v1beta1 — see lib/governance.ts. */
export const MSG_VOTE = '/cosmos.gov.v1.MsgVote'
export const MSG_GRANT_ALLOWANCE = '/cosmos.feegrant.v1beta1.MsgGrantAllowance'
export const MSG_REVOKE_ALLOWANCE = '/cosmos.feegrant.v1beta1.MsgRevokeAllowance'

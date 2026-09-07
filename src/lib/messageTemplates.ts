import type { Msg } from 'secretjs'

import { BECH32_PREFIX, DENOM } from '@/chains/secret4'
import {
  MSG_BEGIN_REDELEGATE,
  MSG_DELEGATE,
  MSG_EXECUTE_CONTRACT,
  MSG_GRANT_ALLOWANCE,
  MSG_REVOKE_ALLOWANCE,
  MSG_SEND,
  MSG_SET_AUTO_RESTAKE,
  MSG_TRANSFER,
  MSG_UNDELEGATE,
  MSG_WITHDRAW_REWARD
} from '@/lib/msgTypes'

/**
 * Raw message templates for Powertools' composer.
 *
 * This is the one place in the app where a person edits JSON and it becomes a
 * signed message — every other screen builds its own messages from a form so
 * a typo cannot reach the chain. That tradeoff is the point of a power tool:
 * whatever the SDK can sign, this can send, without the app standing in the
 * way of a case it did not anticipate. Keplr's own confirmation screen is
 * still the backstop it always is.
 *
 * The set covered here is deliberately not exhaustive — `MsgCreateValidator`,
 * `MsgStoreCode` and vesting-account creation need inputs (raw wasm bytes, a
 * consensus pubkey) that do not belong in a JSON textarea. Everything else a
 * wallet plausibly needs to send by hand is here.
 */

/** The one `secretjs` import the composer needs, threaded through rather than
 *  imported at this module's top level — `secretjs` is a multi-megabyte
 *  dependency, and a JSON-template registry has no reason to force it into
 *  whatever bundle first imports this file. */
export type Secretjs = typeof import('secretjs')

export interface MessageTemplate {
  /** Groups the picker the way the chain groups its own modules. */
  module: string
  typeUrl: string
  /** A filled-in JSON template — the connected address and a placeholder
   *  recipient, never a blank object, since blank invites guessing at field
   *  names instead of editing real ones. */
  example: (secretjs: Secretjs, address: string) => Record<string, unknown>
  /** Turns the edited JSON into a signable message. Amount fields are typed
   *  as "1uscrt"-style strings because that is what a person writes; each
   *  template parses the ones its own message actually has. */
  build: (secretjs: Secretjs, content: Record<string, unknown>) => Msg
}

const str = (content: Record<string, unknown>, key: string): string => String(content[key] ?? '')

export const MESSAGE_TEMPLATES: Record<string, MessageTemplate> = {
  MsgSend: {
    module: 'bank',
    typeUrl: MSG_SEND,
    example: (_s, address) => ({
      from_address: address,
      to_address: `${BECH32_PREFIX}1example`,
      amount: `1${DENOM}`
    }),
    build: (s, c) =>
      new s.MsgSend({
        from_address: str(c, 'from_address'),
        to_address: str(c, 'to_address'),
        amount: s.coinsFromString(str(c, 'amount'))
      })
  },
  MsgMultiSend: {
    module: 'bank',
    typeUrl: '/cosmos.bank.v1beta1.MsgMultiSend',
    example: (_s, address) => ({
      inputs: [{ address, coins: `2${DENOM}` }],
      outputs: [
        { address: `${BECH32_PREFIX}1example`, coins: `1${DENOM}` },
        { address: `${BECH32_PREFIX}1example`, coins: `1${DENOM}` }
      ]
    }),
    build: (s, c) => {
      const inputs = (c.inputs as Array<{ address: string; coins: string }>).map((input) => ({
        address: input.address,
        coins: s.coinsFromString(input.coins)
      }))
      const outputs = (c.outputs as Array<{ address: string; coins: string }>).map((output) => ({
        address: output.address,
        coins: s.coinsFromString(output.coins)
      }))
      return new s.MsgMultiSend({ inputs, outputs })
    }
  },
  MsgDelegate: {
    module: 'staking',
    typeUrl: MSG_DELEGATE,
    example: (_s, address) => ({
      delegator_address: address,
      validator_address: `${BECH32_PREFIX}valoper1example`,
      amount: `1${DENOM}`
    }),
    build: (s, c) =>
      new s.MsgDelegate({
        delegator_address: str(c, 'delegator_address'),
        validator_address: str(c, 'validator_address'),
        amount: s.coinFromString(str(c, 'amount'))
      })
  },
  MsgUndelegate: {
    module: 'staking',
    typeUrl: MSG_UNDELEGATE,
    example: (_s, address) => ({
      delegator_address: address,
      validator_address: `${BECH32_PREFIX}valoper1example`,
      amount: `1${DENOM}`
    }),
    build: (s, c) =>
      new s.MsgUndelegate({
        delegator_address: str(c, 'delegator_address'),
        validator_address: str(c, 'validator_address'),
        amount: s.coinFromString(str(c, 'amount'))
      })
  },
  MsgBeginRedelegate: {
    module: 'staking',
    typeUrl: MSG_BEGIN_REDELEGATE,
    example: (_s, address) => ({
      delegator_address: address,
      validator_src_address: `${BECH32_PREFIX}valoper1example`,
      validator_dst_address: `${BECH32_PREFIX}valoper1example`,
      amount: `1${DENOM}`
    }),
    build: (s, c) =>
      new s.MsgBeginRedelegate({
        delegator_address: str(c, 'delegator_address'),
        validator_src_address: str(c, 'validator_src_address'),
        validator_dst_address: str(c, 'validator_dst_address'),
        amount: s.coinFromString(str(c, 'amount'))
      })
  },
  MsgSetAutoRestake: {
    module: 'distribution',
    typeUrl: MSG_SET_AUTO_RESTAKE,
    example: (_s, address) => ({
      delegator_address: address,
      validator_address: `${BECH32_PREFIX}valoper1example`,
      enabled: true
    }),
    build: (s, c) =>
      new s.MsgSetAutoRestake({
        delegator_address: str(c, 'delegator_address'),
        validator_address: str(c, 'validator_address'),
        enabled: Boolean(c.enabled)
      })
  },
  MsgWithdrawDelegatorReward: {
    module: 'distribution',
    typeUrl: MSG_WITHDRAW_REWARD,
    example: (_s, address) => ({
      delegator_address: address,
      validator_address: `${BECH32_PREFIX}valoper1example`
    }),
    build: (s, c) =>
      new s.MsgWithdrawDelegatorReward({
        delegator_address: str(c, 'delegator_address'),
        validator_address: str(c, 'validator_address')
      })
  },
  MsgWithdrawValidatorCommission: {
    module: 'distribution',
    typeUrl: '/cosmos.distribution.v1beta1.MsgWithdrawValidatorCommission',
    example: (s, address) => ({
      validator_address: s.selfDelegatorAddressToValidatorAddress(address, BECH32_PREFIX)
    }),
    build: (s, c) => new s.MsgWithdrawValidatorCommission({ validator_address: str(c, 'validator_address') })
  },
  MsgSetWithdrawAddress: {
    module: 'distribution',
    typeUrl: '/cosmos.distribution.v1beta1.MsgSetWithdrawAddress',
    example: (_s, address) => ({
      delegator_address: address,
      withdraw_address: `${BECH32_PREFIX}1example`
    }),
    build: (s, c) =>
      new s.MsgSetWithdrawAddress({
        delegator_address: str(c, 'delegator_address'),
        withdraw_address: str(c, 'withdraw_address')
      })
  },
  MsgFundCommunityPool: {
    module: 'distribution',
    typeUrl: '/cosmos.distribution.v1beta1.MsgFundCommunityPool',
    example: (_s, address) => ({ depositor: address, amount: `1${DENOM}` }),
    build: (s, c) =>
      new s.MsgFundCommunityPool({ depositor: str(c, 'depositor'), amount: s.coinsFromString(str(c, 'amount')) })
  },
  MsgExecuteContract: {
    module: 'compute',
    typeUrl: MSG_EXECUTE_CONTRACT,
    example: (_s, address) => ({
      sender: address,
      contract_address: `${BECH32_PREFIX}1example`,
      code_hash: '',
      msg: { set_viewing_key: { key: 'a viewing key' } },
      sent_funds: ''
    }),
    build: (s, c) => {
      const sentFunds = str(c, 'sent_funds')
      return new s.MsgExecuteContract({
        sender: str(c, 'sender'),
        contract_address: str(c, 'contract_address'),
        code_hash: str(c, 'code_hash') || undefined,
        msg: c.msg as object,
        sent_funds: sentFunds ? s.coinsFromString(sentFunds) : []
      })
    }
  },
  MsgInstantiateContract: {
    module: 'compute',
    typeUrl: '/secret.compute.v1beta1.MsgInstantiateContract',
    example: (_s, address) => ({
      sender: address,
      code_id: 1,
      code_hash: '',
      label: `instance ${Date.now()}`,
      init_msg: {},
      init_funds: ''
    }),
    build: (s, c) => {
      const initFunds = str(c, 'init_funds')
      return new s.MsgInstantiateContract({
        sender: str(c, 'sender'),
        code_id: Number(c.code_id),
        code_hash: str(c, 'code_hash') || undefined,
        label: str(c, 'label'),
        init_msg: c.init_msg as object,
        init_funds: initFunds ? s.coinsFromString(initFunds) : []
      })
    }
  },
  MsgTransfer: {
    module: 'ibc-transfer',
    typeUrl: MSG_TRANSFER,
    example: (_s, address) => ({
      sender: address,
      receiver: 'osmo1example',
      token: `1${DENOM}`,
      source_channel: 'channel-1',
      source_port: 'transfer',
      // Seconds from now, not a Unix timestamp — `build` adds the current
      // time, the same convenience the reference dashboard's own tool
      // offers, since typing a correct absolute deadline by hand invites an
      // instant reject.
      timeout_seconds: '600',
      memo: ''
    }),
    build: (s, c) =>
      new s.MsgTransfer({
        sender: str(c, 'sender'),
        receiver: str(c, 'receiver'),
        token: s.coinFromString(str(c, 'token')),
        source_channel: str(c, 'source_channel'),
        source_port: str(c, 'source_port') || 'transfer',
        // secretjs takes seconds here, unlike cosmjs, which wants nanoseconds.
        timeout_timestamp: String(Math.floor(Date.now() / 1000) + Number(c.timeout_seconds ?? 600)),
        memo: str(c, 'memo')
      })
  },
  MsgGrantAllowance: {
    module: 'feegrant',
    typeUrl: MSG_GRANT_ALLOWANCE,
    example: (_s, address) => ({
      granter: address,
      grantee: `${BECH32_PREFIX}1example`,
      // No expiry by default. To set one, add an `expiration` object here
      // shaped like `{ "seconds": "1893456000", "nanos": 0 }`.
      allowance: { spend_limit: `1${DENOM}` }
    }),
    build: (s, c) => {
      const allowance = c.allowance as { spend_limit: string; expiration?: { seconds: string; nanos: number } }
      return new s.MsgGrantAllowance({
        granter: str(c, 'granter'),
        grantee: str(c, 'grantee'),
        allowance: { spend_limit: s.coinsFromString(allowance.spend_limit), expiration: allowance.expiration }
      })
    }
  },
  MsgRevokeAllowance: {
    module: 'feegrant',
    typeUrl: MSG_REVOKE_ALLOWANCE,
    example: (_s, address) => ({ granter: address, grantee: `${BECH32_PREFIX}1example` }),
    build: (s, c) => new s.MsgRevokeAllowance({ granter: str(c, 'granter'), grantee: str(c, 'grantee') })
  },
  MsgVote: {
    module: 'gov',
    typeUrl: '/cosmos.gov.v1.MsgVote',
    example: (_s, address) => ({ voter: address, proposal_id: '1', option: 'YES', metadata: '' }),
    build: (s, c) => {
      const option = str(c, 'option').toUpperCase()
      const byName: Record<string, number> = {
        YES: s.VoteOption.VOTE_OPTION_YES,
        NO: s.VoteOption.VOTE_OPTION_NO,
        ABSTAIN: s.VoteOption.VOTE_OPTION_ABSTAIN,
        NO_WITH_VETO: s.VoteOption.VOTE_OPTION_NO_WITH_VETO
      }
      const value = byName[option]
      if (value === undefined) throw new Error(`Unknown vote option "${option}" — use YES, NO, ABSTAIN or NO_WITH_VETO.`)
      return new s.MsgVote({
        voter: str(c, 'voter'),
        proposal_id: str(c, 'proposal_id'),
        option: value,
        metadata: str(c, 'metadata')
      })
    }
  },
  MsgDeposit: {
    module: 'gov',
    typeUrl: '/cosmos.gov.v1.MsgDeposit',
    example: (_s, address) => ({ depositor: address, proposal_id: '1', amount: `1${DENOM}` }),
    build: (s, c) =>
      new s.MsgDeposit({
        depositor: str(c, 'depositor'),
        proposal_id: str(c, 'proposal_id'),
        amount: s.coinsFromString(str(c, 'amount'))
      })
  },
  MsgUnjail: {
    module: 'slashing',
    typeUrl: '/cosmos.slashing.v1beta1.MsgUnjail',
    example: (s, address) => ({
      validator_addr: s.selfDelegatorAddressToValidatorAddress(address, BECH32_PREFIX)
    }),
    build: (s, c) => new s.MsgUnjail({ validator_addr: str(c, 'validator_addr') })
  }
}

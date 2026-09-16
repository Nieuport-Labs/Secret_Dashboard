/**
 * What a message actually does, in a sentence.
 *
 * A proposal rendered as JSON is only slightly better than a proposal rendered
 * as base64. Both ask a member to audit a data structure in order to answer a
 * question they already had in words — "is this the payment we agreed?" — and
 * the translation between the two is exactly where a mistake hides. A
 * recipient one character out, `1000000` where `10000000` was meant, a
 * validator that is not the one discussed: all of them are invisible in a
 * block of JSON and obvious in a line of prose.
 *
 * So every message this app can recognise is turned into a headline and a
 * short table. What cannot be recognised says so plainly and falls back to the
 * JSON — an honest "this app does not know what this does, read it yourself"
 * is worth more than a confident summary of a message it guessed at.
 *
 * ## Amounts are never masked here
 *
 * The rest of the app respects the privacy toggle, which blanks figures so a
 * balance is not readable over a shoulder. This screen is the one place that
 * must not: the amount is the thing being agreed to, and a member who cannot
 * see it cannot approve it. Every figure is formatted with `reveal`.
 *
 * ## It describes the declaration, not the ciphertext
 *
 * For a contract call this reads `content.msg` — what the proposal *claims*
 * the encrypted body says. That claim is only worth reading because the
 * checklist beside it proves the ciphertext matches, message by message. On
 * its own this would be decoration, and the dangerous kind: it would look like
 * review. See `verify.ts`.
 */

import { DECIMALS, DENOM, DISPLAY_DENOM } from '@/chains/secret4'
import { formatAmount, shortenAddress } from '@/lib/format'
import type { DeclaredMsg } from '@/lib/multisig/messages'
import { SSCRT_ADDRESS, tokenByAddress } from '@/tokens/registry'
import { tokenAddressForBankDenom } from '@/tokens/routes'

export interface SummaryRow {
  label: string
  value: string
  /** An address or a hash: rendered in the monospace face, and never truncated in the DOM. */
  mono?: boolean
}

export interface MessageSummary {
  /** One line, in the voice of the thing being done: "Send 10 SCRT". */
  headline: string
  rows: SummaryRow[]
  /**
   * False when this app cannot say what the message does. The screen then
   * shows the JSON and says that it could not read it — which is a refusal to
   * guess, not a failure to render.
   */
  recognised: boolean
  /** Worth a second look before signing. Not errors; the checklist has those. */
  notes?: string[]
}

/* -------------------------------------------------------------------------- */
/* Formatting                                                                  */
/* -------------------------------------------------------------------------- */

const str = (content: Record<string, unknown>, key: string): string => String(content[key] ?? '')

/** What the chain's own denomination is called, and how finely it divides. */
function denomInfo(denom: string): { symbol: string; decimals: number } {
  if (denom === DENOM) return { symbol: DISPLAY_DENOM, decimals: DECIMALS }

  const contract = tokenAddressForBankDenom(denom)
  const token = contract ? tokenByAddress(contract) : undefined
  if (token) return { symbol: token.symbol, decimals: token.decimals }

  // An IBC voucher this app has no entry for. Showing the raw figure beside
  // the raw denom is honest; inventing six decimal places is not.
  return { symbol: denom.startsWith('ibc/') ? `${denom.slice(0, 11)}…` : denom, decimals: 0 }
}

/**
 * `"10000000uscrt"` as `"10 SCRT"`.
 *
 * This is the shape the composer's templates use — a figure and a
 * denomination in one string, which is what a person types. Anything that does
 * not parse comes back verbatim rather than mangled.
 */
export function formatCoinString(value: string): string {
  const match = /^(\d+)([a-zA-Z][a-zA-Z0-9/:._-]*)$/.exec(value.trim())
  if (!match) return value

  const [, amount, denom] = match
  const { symbol, decimals } = denomInfo(denom)
  return `${formatAmount(amount, { decimals, reveal: true })} ${symbol}`
}

/** A SNIP-20 figure, which carries no denomination of its own. */
function formatTokenAmount(amount: string, contract: string): string {
  const token = tokenByAddress(contract)
  if (!token) return amount
  return `${formatAmount(amount, { decimals: token.decimals, reveal: true })} ${tokenName(contract)}`
}

function tokenName(contract: string): string {
  const token = tokenByAddress(contract)
  if (!token) return 'a token'
  // sSCRT is listed under the ticker SCRT, which would read as the native coin
  // in a sentence about wrapping one into the other.
  return contract === SSCRT_ADDRESS ? 'sSCRT' : token.symbol
}

function account(address: string): string {
  return address ? shortenAddress(address, 14, 8, { reveal: true }) : '—'
}

/* -------------------------------------------------------------------------- */
/* Contract calls                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The SNIP-20 messages worth naming.
 *
 * Not an attempt at every contract on the network — an unknown call falls back
 * to JSON, which is the right answer for one. These are the handful this app
 * itself sends, so a group doing what the wallet does gets the same words for
 * it.
 */
function describeContractCall(content: Record<string, unknown>): MessageSummary | undefined {
  const contract = str(content, 'contract_address')
  const inner = content.msg as Record<string, unknown> | undefined
  if (!inner || typeof inner !== 'object') return undefined

  const [action, body] = Object.entries(inner)[0] ?? []
  const fields = (body ?? {}) as Record<string, unknown>
  const funds = str(content, 'sent_funds')

  const contractRow: SummaryRow = { label: 'Contract', value: contract, mono: true }

  switch (action) {
    case 'deposit':
      return {
        headline: funds
          ? `Wrap ${formatCoinString(funds)} into ${tokenName(contract)}`
          : `Wrap into ${tokenName(contract)}`,
        rows: [
          { label: 'Amount', value: formatCoinString(funds) },
          { label: 'Becomes', value: tokenName(contract) },
          contractRow
        ],
        recognised: true,
        notes: ['Wrapping makes the balance private. The amount is public until it lands.']
      }

    case 'redeem':
      return {
        headline: `Unwrap ${formatTokenAmount(str(fields, 'amount'), contract)} into ${DISPLAY_DENOM}`,
        rows: [
          { label: 'Amount', value: formatTokenAmount(str(fields, 'amount'), contract) },
          { label: 'Becomes', value: DISPLAY_DENOM },
          contractRow
        ],
        recognised: true,
        notes: ['Unwrapping makes the balance public again.']
      }

    case 'transfer':
      return {
        headline: `Send ${formatTokenAmount(str(fields, 'amount'), contract)}`,
        rows: [
          { label: 'Amount', value: formatTokenAmount(str(fields, 'amount'), contract) },
          { label: 'To', value: str(fields, 'recipient'), mono: true },
          contractRow
        ],
        recognised: true
      }

    case 'send':
      return {
        headline: `Send ${formatTokenAmount(str(fields, 'amount'), contract)} to a contract`,
        rows: [
          { label: 'Amount', value: formatTokenAmount(str(fields, 'amount'), contract) },
          { label: 'To contract', value: str(fields, 'recipient'), mono: true },
          contractRow
        ],
        recognised: true,
        notes: [
          'Sending to a contract runs code there with the tokens attached. What that code does is not ' +
            'described by this message.'
        ]
      }

    case 'set_viewing_key':
    case 'create_viewing_key':
      return {
        headline: `Set a viewing key on ${tokenName(contract)}`,
        rows: [
          { label: 'Token', value: tokenName(contract) },
          contractRow,
          // The key itself is deliberately absent. Every member gets it by
          // decrypting this proposal; printing it in full on a screen that may
          // be shared or screenshotted adds nothing and risks something.
          { label: 'Key', value: 'included in this proposal, not shown here' }
        ],
        recognised: true,
        notes: [
          'A viewing key is a shared secret. Anyone holding it can read this account’s balance at this ' +
            'token, and it stays valid until the group sets another one.'
        ]
      }

    case 'increase_allowance':
    case 'decrease_allowance':
      return {
        headline: `${action === 'increase_allowance' ? 'Allow' : 'Reduce what'} ${account(str(fields, 'spender'))} ${
          action === 'increase_allowance' ? 'to spend' : 'may spend'
        } ${formatTokenAmount(str(fields, 'amount'), contract)}`,
        rows: [
          { label: 'Spender', value: str(fields, 'spender'), mono: true },
          { label: 'Amount', value: formatTokenAmount(str(fields, 'amount'), contract) },
          contractRow
        ],
        recognised: true,
        notes:
          action === 'increase_allowance'
            ? ['An allowance lets that account move these tokens without asking again.']
            : undefined
      }

    case 'revoke_permit':
      return {
        headline: `Revoke the query permit “${str(fields, 'permit_name')}”`,
        rows: [{ label: 'Permit', value: str(fields, 'permit_name') }, contractRow],
        recognised: true
      }

    default:
      return undefined
  }
}

/* -------------------------------------------------------------------------- */
/* Everything else                                                             */
/* -------------------------------------------------------------------------- */

export interface DescribeContext {
  /** Validator monikers by operator address, where they have been looked up. */
  validatorNames?: Map<string, string>
}

function validator(address: string, context?: DescribeContext): string {
  const moniker = context?.validatorNames?.get(address)
  return moniker ? `${moniker}` : account(address)
}

const VOTE_WORDS: Record<string, string> = {
  YES: 'Yes',
  NO: 'No',
  ABSTAIN: 'Abstain',
  NO_WITH_VETO: 'No with veto'
}

export function describeMessage(message: DeclaredMsg, context?: DescribeContext): MessageSummary {
  const c = message.content

  switch (message.template) {
    case 'MsgSend':
      return {
        headline: `Send ${formatCoinString(str(c, 'amount'))}`,
        rows: [
          { label: 'Amount', value: formatCoinString(str(c, 'amount')) },
          { label: 'To', value: str(c, 'to_address'), mono: true }
        ],
        recognised: true
      }

    case 'MsgDelegate':
      return {
        headline: `Stake ${formatCoinString(str(c, 'amount'))} with ${validator(str(c, 'validator_address'), context)}`,
        rows: [
          { label: 'Amount', value: formatCoinString(str(c, 'amount')) },
          { label: 'Validator', value: str(c, 'validator_address'), mono: true }
        ],
        recognised: true
      }

    case 'MsgUndelegate':
      return {
        headline: `Unstake ${formatCoinString(str(c, 'amount'))} from ${validator(str(c, 'validator_address'), context)}`,
        rows: [
          { label: 'Amount', value: formatCoinString(str(c, 'amount')) },
          { label: 'Validator', value: str(c, 'validator_address'), mono: true }
        ],
        recognised: true,
        notes: ['Unstaking takes 21 days, earns nothing while it runs, and cannot be cancelled.']
      }

    case 'MsgBeginRedelegate':
      return {
        headline: `Move ${formatCoinString(str(c, 'amount'))} to ${validator(str(c, 'validator_dst_address'), context)}`,
        rows: [
          { label: 'Amount', value: formatCoinString(str(c, 'amount')) },
          { label: 'From', value: str(c, 'validator_src_address'), mono: true },
          { label: 'To', value: str(c, 'validator_dst_address'), mono: true }
        ],
        recognised: true,
        notes: ['Redelegating is immediate, but the same stake cannot be moved again for 21 days.']
      }

    case 'MsgWithdrawDelegatorReward':
      return {
        headline: `Claim staking rewards from ${validator(str(c, 'validator_address'), context)}`,
        rows: [{ label: 'Validator', value: str(c, 'validator_address'), mono: true }],
        recognised: true
      }

    case 'MsgSetAutoRestake':
      return {
        headline: `${c.enabled ? 'Turn on' : 'Turn off'} auto-restaking with ${validator(str(c, 'validator_address'), context)}`,
        rows: [
          { label: 'Validator', value: str(c, 'validator_address'), mono: true },
          { label: 'Auto-restake', value: c.enabled ? 'On' : 'Off' }
        ],
        recognised: true
      }

    case 'MsgWithdrawValidatorCommission':
      return {
        headline: 'Claim validator commission',
        rows: [{ label: 'Validator', value: str(c, 'validator_address'), mono: true }],
        recognised: true
      }

    case 'MsgSetWithdrawAddress':
      return {
        headline: `Send staking rewards to ${account(str(c, 'withdraw_address'))} instead`,
        rows: [{ label: 'New address', value: str(c, 'withdraw_address'), mono: true }],
        recognised: true,
        notes: ['Every future reward from this account goes there until it is changed again.']
      }

    case 'MsgFundCommunityPool':
      return {
        headline: `Give ${formatCoinString(str(c, 'amount'))} to the community pool`,
        rows: [{ label: 'Amount', value: formatCoinString(str(c, 'amount')) }],
        recognised: true
      }

    case 'MsgVote': {
      const option = str(c, 'option').toUpperCase()
      return {
        headline: `Vote ${VOTE_WORDS[option] ?? option} on proposal ${str(c, 'proposal_id')}`,
        rows: [
          { label: 'Proposal', value: `#${str(c, 'proposal_id')}` },
          { label: 'Vote', value: VOTE_WORDS[option] ?? option }
        ],
        recognised: true
      }
    }

    case 'MsgDeposit':
      return {
        headline: `Deposit ${formatCoinString(str(c, 'amount'))} on proposal ${str(c, 'proposal_id')}`,
        rows: [
          { label: 'Proposal', value: `#${str(c, 'proposal_id')}` },
          { label: 'Amount', value: formatCoinString(str(c, 'amount')) }
        ],
        recognised: true
      }

    case 'MsgTransfer':
      return {
        headline: `Send ${formatCoinString(str(c, 'token'))} to another chain`,
        rows: [
          { label: 'Amount', value: formatCoinString(str(c, 'token')) },
          { label: 'To', value: str(c, 'receiver'), mono: true },
          { label: 'Channel', value: str(c, 'source_channel') }
        ],
        recognised: true,
        notes: ['An address on the wrong chain, or a closed channel, loses the transfer.']
      }

    case 'MsgGrantAllowance': {
      const allowance = (c.allowance ?? {}) as { spend_limit?: string; expiration?: unknown }
      return {
        headline: `Pay ${account(str(c, 'grantee'))}’s transaction fees`,
        rows: [
          { label: 'For', value: str(c, 'grantee'), mono: true },
          {
            label: 'Up to',
            value: allowance.spend_limit ? formatCoinString(allowance.spend_limit) : 'no limit'
          },
          ...(allowance.expiration ? [{ label: 'Until', value: describeExpiry(allowance.expiration) }] : [])
        ],
        recognised: true,
        notes: allowance.spend_limit
          ? undefined
          : [
              'This allowance has no limit: that account can spend this one’s balance on fees until it is revoked.'
            ]
      }
    }

    case 'MsgRevokeAllowance':
      return {
        headline: `Stop paying ${account(str(c, 'grantee'))}’s fees`,
        rows: [{ label: 'For', value: str(c, 'grantee'), mono: true }],
        recognised: true
      }

    case 'MsgUnjail':
      return {
        headline: 'Bring the validator back into the active set',
        rows: [{ label: 'Validator', value: str(c, 'validator_addr'), mono: true }],
        recognised: true
      }

    case 'MsgMultiSend': {
      const outputs = (c.outputs ?? []) as Array<{ address?: string; coins?: string }>
      return {
        headline: `Send to ${outputs.length} recipient${outputs.length === 1 ? '' : 's'}`,
        rows: outputs.map((output, index) => ({
          label: `To ${index + 1}`,
          value: `${formatCoinString(String(output.coins ?? ''))} → ${String(output.address ?? '')}`,
          mono: true
        })),
        recognised: true
      }
    }

    case 'MsgExecuteContract': {
      const described = describeContractCall(c)
      if (described) return described

      return {
        headline: `Call a contract this app does not recognise`,
        rows: [{ label: 'Contract', value: str(c, 'contract_address'), mono: true }],
        recognised: false,
        notes: ['Read the message below before signing — this app cannot say what it does.']
      }
    }

    default:
      return {
        headline: message.template,
        rows: [],
        recognised: false,
        notes: ['This app cannot describe this message. Read it below before signing.']
      }
  }
}

function describeExpiry(expiration: unknown): string {
  const value = expiration as { seconds?: string | number } | undefined
  const seconds = Number(value?.seconds ?? 0)
  if (!seconds) return 'a set time'
  return new Date(seconds * 1000).toLocaleString()
}

/**
 * Validator addresses a set of messages mentions.
 *
 * So a screen can look their names up once and hand them back through
 * `DescribeContext` — "Stake 10 SCRT with Secret Saturn" is a sentence a member
 * can check against what the group agreed; a valoper address is not.
 */
export function validatorAddressesIn(messages: DeclaredMsg[]): string[] {
  const found = new Set<string>()

  for (const message of messages) {
    for (const key of [
      'validator_address',
      'validator_src_address',
      'validator_dst_address',
      'validator_addr'
    ]) {
      const value = str(message.content, key)
      if (value.startsWith('secretvaloper')) found.add(value)
    }
  }

  return [...found]
}

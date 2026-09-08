import type { Msg, SecretNetworkClient } from 'secretjs'

import { CHAIN_ID, GAS_PRICE_USCRT } from '@/chains/secret4'
import { parseTimestamp } from '@/lib/feegrant-sdk'
import { MSG_EDIT_VALIDATOR, MSG_UNJAIL, MSG_VOTE, MSG_WITHDRAW_COMMISSION } from '@/lib/msgTypes'

/**
 * Acting for another account through `x/authz`.
 *
 * This is what lets someone run a validator from this dashboard without holding
 * its operator key. The operator grants one narrow permission per message type
 * — "this address may cast votes for me", nothing more — and the dashboard then
 * wraps that one message in a `MsgExec` it signs itself.
 *
 * The grant cannot be made from here, by design: it has to be signed by the key
 * this app does not have. So the app's half of the job is to write the exact
 * command the operator runs, and to check afterwards whether it landed.
 */

/* -------------------------------------------------------------------------- */
/* Permissions                                                                 */
/* -------------------------------------------------------------------------- */

export interface Permission {
  msgType: string
  label: string
  /** What the grant lets the grantee do, in the operator's terms. */
  description: string
}

/**
 * The permissions this dashboard knows how to use.
 *
 * Deliberately one per operation rather than a single "operate" grant: authz
 * has no such thing, and offering the operator four separate commands lets them
 * hand over voting without also handing over their commission.
 */
export const VALIDATOR_PERMISSIONS: Permission[] = [
  {
    msgType: MSG_VOTE,
    label: 'Vote on proposals',
    description: 'Cast and change this validator’s governance votes.'
  },
  {
    msgType: MSG_WITHDRAW_COMMISSION,
    label: 'Withdraw commission',
    description: 'Send earned commission to the validator’s own withdrawal address.'
  },
  {
    msgType: MSG_EDIT_VALIDATOR,
    label: 'Edit the validator',
    description: 'Change the moniker, website, description and commission rate.'
  },
  {
    msgType: MSG_UNJAIL,
    label: 'Unjail',
    description: 'Return the validator to the active set after downtime.'
  }
]

/* -------------------------------------------------------------------------- */
/* Reading grants                                                              */
/* -------------------------------------------------------------------------- */

export interface Grant {
  msgType: string
  /** Absent means the operator granted it without an expiry. */
  expiration?: Date
}

/**
 * Every permission this wallet holds for that operator, of the ones above.
 *
 * Asked as one query per type rather than paging `granterGrants`: an operator
 * may have granted dozens of unrelated things to other addresses, and this only
 * ever cares about four of them.
 *
 * A failed query yields no grant rather than an error. The consequence of
 * getting it wrong in that direction is an offered button the chain refuses,
 * which is recoverable; the other direction hides a permission the user
 * actually has and leaves them re-running a command that already worked.
 */
export async function queryValidatorGrants(
  client: SecretNetworkClient,
  granter: string,
  grantee: string
): Promise<Grant[]> {
  const found = await Promise.all(
    VALIDATOR_PERMISSIONS.map(async ({ msgType }): Promise<Grant | undefined> => {
      try {
        const response = await client.query.authz.grants({
          granter,
          grantee,
          msg_type_url: msgType
        })
        const grant = response.grants?.[0]
        if (!grant) return undefined

        const expiration = parseTimestamp(grant.expiration)
        // An expired grant is still returned by some nodes until the queue
        // prunes it, and treating it as live would offer a button that fails.
        if (expiration && expiration <= new Date()) return undefined

        return { msgType, expiration }
      } catch {
        return undefined
      }
    })
  )

  return found.filter((grant): grant is Grant => grant !== undefined)
}

/* -------------------------------------------------------------------------- */
/* Executing under a grant                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Wrap messages so they are signed by the grantee but authored by the granter.
 *
 * Each inner message must have exactly one signer, and it must be the granter —
 * which every validator operation satisfies, since the chain derives their
 * signer from the validator address rather than taking it as a field.
 */
export async function execMessage(grantee: string, msgs: Msg[]): Promise<Msg> {
  const { MsgExec } = await import('secretjs')
  return new MsgExec({ grantee, msgs })
}

/* -------------------------------------------------------------------------- */
/* Writing the command                                                         */
/* -------------------------------------------------------------------------- */

/**
 * How long a generated grant lasts.
 *
 * A year, not forever: authz has no revocation prompt and an operator who
 * forgets they granted this has no reminder, so the permission lapsing on its
 * own is the safer default. The number is plainly visible in the command for
 * anyone who wants to change it.
 */
const GRANT_YEARS = 1

/** Shared across both commands so a copied pair cannot disagree on fees. */
const FEE_FLAGS = `--gas 250000 --gas-prices ${GAS_PRICE_USCRT}uscrt --gas-adjustment 1.5 --chain-id ${CHAIN_ID}`

export function grantExpiry(from = new Date()): Date {
  const expiry = new Date(from)
  expiry.setFullYear(expiry.getFullYear() + GRANT_YEARS)
  return expiry
}

/**
 * The `secretcli` command the operator runs to hand over one permission.
 *
 * Written against the type URLs this app actually broadcasts. That matters for
 * voting in particular: secret-4 serves both `x/gov` v1 and v1beta1, authz
 * matches the grant on the type URL as a plain string, and a grant naming the
 * v1beta1 message would not authorise the v1 one this app sends.
 */
export function grantCommand(
  granter: string,
  grantee: string,
  msgType: string,
  expiry = grantExpiry()
): string {
  const seconds = Math.floor(expiry.getTime() / 1000)
  return `secretcli tx authz grant ${grantee} generic --msg-type ${msgType} --from ${granter} --expiration ${seconds} ${FEE_FLAGS}`
}

/** The command that takes it back. */
export function revokeCommand(granter: string, grantee: string, msgType: string): string {
  return `secretcli tx authz revoke ${grantee} ${msgType} --from ${granter} ${FEE_FLAGS}`
}

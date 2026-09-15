import type { SecretNetworkClient } from 'secretjs'

import { codeHashFor } from '@/lib/codeHash'
import { errorMessage } from '@/lib/errors'
import { covers, withPermit, type Permit } from '@/lib/permit'
import { STKD_SCRT_ADDRESS } from '@/tokens/registry'

/**
 * Shade's SCRT staking derivative, stkd-SCRT.
 *
 * The contract is a SNIP-20 with a staking contract behind it: `stake` takes
 * native SCRT and mints, `unbond` burns and puts SCRT in a queue, `claim` takes
 * the matured SCRT out. To the rest of this app it is just another token in the
 * registry, which is exactly the problem this module fixes — a balance you can
 * see and cannot leave is not a balance, and until now the only way out of
 * stkd-SCRT from here was to sell it.
 *
 * Unbonding is batched: the contract cannot hold more than seven unbonding
 * delegations at once for all of its users together, so requests are collected
 * and sent as one batch every `unbonding_batch_interval`. That is why a request
 * has two waits in front of it — until the next batch leaves, and then the
 * chain's own 21 days — and why the screen has to show both.
 *
 * Schema read off the deployed contract rather than from documentation: the
 * query variants come from its own parse errors and the field names from the
 * strings in its wasm (code id 432), cross-checked against Shade's own
 * `stkd_scrt.rs` interface. See docs/chain-facts.md.
 */

/** uSCRT per whole stkd-SCRT is quoted with this many decimals. */
export const PRICE_DECIMALS = 6

export interface DerivativeUnbonding {
  /** Base units of SCRT this row returns. `0` when the contract's figure was
   *  not base units at all — then `rawAmount` carries what it did say. */
  amount: string
  /** Set only when the amount could not be read as base units. */
  rawAmount?: string
  /**
   * When the chain releases it. Absent while the request is still waiting for
   * its batch to leave — there is no unbonding delegation to date yet.
   */
  at?: Date
  mature: boolean
}

export interface DerivativeInfo {
  /** uSCRT one stkd-SCRT is worth, scaled by `PRICE_DECIMALS`. */
  price: string
  /** The chain's unbonding period, in seconds. */
  unbondingSeconds: number
  /** How often the queued requests are sent as one batch, in seconds. */
  batchIntervalSeconds: number
  /** When the next batch leaves. */
  nextBatchAt?: Date
}

/** A read the permit is not allowed to make, which signing again fixes. */
export class PermitRefused extends Error {}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

/**
 * The contract rejects a permit by answering, not by failing, and it does so in
 * two different ways — a missing permission and a bad signature — both of which
 * mean the same thing here: this permit cannot read it, sign another.
 */
function refusal(message: string): boolean {
  return /no permission|unauthorized|permit|signature/i.test(message)
}

async function query<T>(client: SecretNetworkClient, message: object): Promise<T> {
  const codeHash = await codeHashFor(client, STKD_SCRT_ADDRESS)
  try {
    const reply = (await client.query.compute.queryContract({
      contract_address: STKD_SCRT_ADDRESS,
      code_hash: codeHash,
      query: message
    })) as T
    // A refusal comes back as a normal reply carrying the contract's error
    // object, so a successful HTTP round trip is not a successful read.
    const text = typeof reply === 'string' ? reply : JSON.stringify(reply)
    if (/parse_err|generic_err|viewing_key_error/.test(text)) {
      if (refusal(text)) throw new PermitRefused(text)
      throw new Error(text.slice(0, 200))
    }
    return reply
  } catch (error) {
    if (error instanceof PermitRefused) throw error
    const message_ = errorMessage(error)
    if (refusal(message_)) throw new PermitRefused(message_)
    throw new Error(message_)
  }
}

/** Public, so it is read without a permit and before one is signed. */
export async function queryDerivativeInfo(client: SecretNetworkClient): Promise<DerivativeInfo> {
  const reply = await query<{
    staking_info?: {
      price?: string
      unbonding_time?: number
      unbonding_batch_interval?: number
      next_unbonding_batch_time?: number
    }
  }>(client, { staking_info: { time: nowSeconds() } })

  const info = reply?.staking_info
  if (!info?.price) throw new Error('The derivative returned no price.')

  return {
    price: info.price,
    unbondingSeconds: info.unbonding_time ?? 0,
    batchIntervalSeconds: info.unbonding_batch_interval ?? 0,
    nextBatchAt: info.next_unbonding_batch_time ? new Date(info.next_unbonding_batch_time * 1000) : undefined
  }
}

export interface DerivativeQueue {
  entries: DerivativeUnbonding[]
  /** Base units of SCRT `claim` would pay out now. */
  claimable: string
  /**
   * What has been asked for but not yet sent — it leaves with the next batch,
   * and only then starts the chain's 21 days.
   *
   * A separate field rather than an entry in `unbondings`, because the contract
   * keeps it separate: there is no unbonding delegation behind it yet, so it
   * has no maturity date of its own, only the batch's estimate. Anyone who has
   * just pressed Unstake is looking for exactly this figure, and a queue that
   * omits it answers "nothing is happening" to someone who has just made
   * something happen.
   */
  nextBatch: NextBatch
}

/** The pending request, in the same shape a queue entry's amount takes. */
export interface NextBatch {
  amount: string
  /** Set only when the amount could not be read as base units. */
  rawAmount?: string
  /** The batch's own maturity estimate, once the contract offers one. */
  at?: Date
}

/**
 * Every unbonding request this account has in the queue.
 *
 * `time` is passed because both answers that matter depend on it: without it
 * the contract returns no `claimable_scrt` and cannot say which entries have
 * matured. Maturity is its answer rather than a date comparison made here — a
 * batch is released when the contract processes it, which is not the same
 * instant its unbonding delegation ended.
 *
 * The amount field is read under both spellings. Shade's published interface
 * calls it `amount`; the contract deployed on secret-4 answers `unbond_amount`.
 */
export async function queryDerivativeQueue(
  client: SecretNetworkClient,
  permit: Permit
): Promise<DerivativeQueue> {
  if (!covers(permit, STKD_SCRT_ADDRESS)) throw new PermitRefused('This permit does not cover stkd-SCRT.')

  const reply = await query<{
    unbonding?: {
      claimable_scrt?: string | number
      unbond_amount_in_next_batch?: string | number
      estimated_time_of_maturity_for_next_batch?: number
      unbondings?: {
        unbond_amount?: string | number
        amount?: string | number
        unbonds_at?: number
        is_mature?: boolean
      }[]
    }
  }>(client, withPermit(permit, { unbonding: { time: nowSeconds() } }))

  const now = Date.now()
  const entries: DerivativeUnbonding[] = (reply?.unbonding?.unbondings ?? []).map((row) => {
    const at = row.unbonds_at ? new Date(row.unbonds_at * 1000) : undefined
    return {
      ...readAmount(row.unbond_amount ?? row.amount),
      at,
      // `is_mature` is optional in the interface, so a missing one falls back to
      // the date rather than to "no".
      mature: row.is_mature ?? Boolean(at && at.getTime() <= now)
    }
  })

  const claimable = readAmount(reply?.unbonding?.claimable_scrt).amount
  const maturity = reply?.unbonding?.estimated_time_of_maturity_for_next_batch

  return {
    entries,
    claimable: claimable !== '0' ? claimable : sumAmounts(entries.filter((row) => row.mature)),
    nextBatch: {
      ...readAmount(reply?.unbonding?.unbond_amount_in_next_batch),
      at: maturity ? new Date(maturity * 1000) : undefined
    }
  }
}

/**
 * One amount, however the contract chose to spell it.
 *
 * A Uint128 is meant to arrive as a decimal string, but this schema was read
 * off a wasm binary rather than from a published interface, and the difference
 * between a string and a JSON number is invisible until `BigInt()` is handed
 * something it refuses. One such value used to throw inside the read and take
 * every figure on the screen down with it — including the rows that had parsed
 * perfectly well. So a value that cannot be read is carried as itself and
 * counted as nothing, and the screen says which.
 */
function readAmount(value: string | number | undefined): { amount: string; rawAmount?: string } {
  if (value === undefined || value === null) return { amount: '0' }
  if (typeof value === 'number') {
    return Number.isFinite(value) && Number.isInteger(value)
      ? { amount: value.toString() }
      : { amount: '0', rawAmount: String(value) }
  }

  const trimmed = value.trim()
  if (/^\d+$/.test(trimmed)) return { amount: trimmed }
  return { amount: '0', rawAmount: value }
}

/** Adds base units, and never throws over one row it could not read. */
export function sumAmounts(rows: DerivativeUnbonding[]): string {
  let total = 0n
  for (const row of rows) {
    try {
      total += BigInt(row.amount)
    } catch {
      // Already reported on the row itself; a total is not the place to fail.
    }
  }
  return total.toString()
}

/* -------------------------------------------------------------------------- */
/* The offer to look                                                           */
/* -------------------------------------------------------------------------- */

const OFFER_KEY = 'secret-dashboard:stkd-offer'

/**
 * Whether this account has waved away the offer to read the queue.
 *
 * An unbonding position is invisible without a signature and leaves no trace in
 * any balance — it has left the token and not yet arrived as SCRT — so the only
 * way to find one is to ask. Which means offering, to people who mostly have
 * nothing there. This remembers a "no", so the offer is made once and not on
 * every visit for the rest of the account's life.
 */
export function queueOfferDismissed(address: string): boolean {
  try {
    return localStorage.getItem(`${OFFER_KEY}:${address}`) === '1'
  } catch {
    return false
  }
}

export function dismissQueueOffer(address: string): void {
  try {
    localStorage.setItem(`${OFFER_KEY}:${address}`, '1')
  } catch {
    // Then it is offered again next time, which is the harmless direction.
  }
}

/* -------------------------------------------------------------------------- */
/* Execute messages                                                            */
/* -------------------------------------------------------------------------- */

/** Burn stkd-SCRT and join the unbonding queue. The amount is in stkd-SCRT. */
export function unbondMsg(amount: string): { unbond: { redeem_amount: string } } {
  return { unbond: { redeem_amount: amount } }
}

/** Take every matured request out of the queue in one go. */
export const claimMsg = { claim: {} } as const

/**
 * What an amount of stkd-SCRT is worth in SCRT, in base units.
 *
 * Before the contract's withdraw fee, which it takes at `unbond` and does not
 * publish as a rate — `fee_info` returns a raw number whose scale the contract
 * keeps to itself. So this is what the position is worth, not a promise of what
 * will arrive, and the screen says as much.
 */
export function scrtValueOf(amount: string, price: string): string {
  return ((BigInt(amount) * BigInt(price)) / 10n ** BigInt(PRICE_DECIMALS)).toString()
}

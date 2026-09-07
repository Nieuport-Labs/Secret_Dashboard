import type { SecretNetworkClient } from 'secretjs'

import { codeHashFor } from '@/lib/codeHash'
import { covers, withPermit, type Permit } from '@/lib/permit'

/**
 * SNIP-20 reads, authenticated with a SNIP-24 permit.
 *
 * Every query here needs a permit, and a permit names the tokens it covers, so
 * the first thing each does is check coverage. Skipping that check turns "you
 * signed before this token existed" into an opaque contract error that reads
 * like the node is broken.
 */

export type BalanceOutcome =
  | { status: 'ok'; amount: string }
  /** The permit does not name this token — the user must sign a new one. */
  | { status: 'not-covered' }
  /** The contract rejected the permit: revoked, wrong chain, or wrong signer. */
  | { status: 'unauthorized'; message: string }
  | { status: 'error'; message: string }

interface BalanceReply {
  balance?: { amount?: string }
  viewing_key_error?: { msg?: string }
}

export interface TokenInfoReply {
  name: string
  symbol: string
  decimals: number
}

/** `token_info` needs no permit — it is the same for every caller. */
export async function queryTokenInfo(
  client: SecretNetworkClient,
  contractAddress: string
): Promise<TokenInfoReply> {
  const codeHash = await codeHashFor(client, contractAddress)
  const reply = (await client.query.compute.queryContract({
    contract_address: contractAddress,
    code_hash: codeHash,
    query: { token_info: {} }
  })) as { token_info?: TokenInfoReply }

  const info = reply?.token_info
  if (!info || typeof info.symbol !== 'string' || typeof info.decimals !== 'number') {
    throw new Error(`Unexpected reply: ${JSON.stringify(reply).slice(0, 160)}`)
  }
  return info
}

export async function queryBalance(
  client: SecretNetworkClient,
  permit: Permit,
  contractAddress: string
): Promise<BalanceOutcome> {
  if (!covers(permit, contractAddress)) return { status: 'not-covered' }

  try {
    const codeHash = await codeHashFor(client, contractAddress)
    const reply = (await client.query.compute.queryContract({
      contract_address: contractAddress,
      code_hash: codeHash,
      query: withPermit(permit, { balance: {} })
    })) as BalanceReply

    // A rejected permit comes back as a normal reply carrying an error object,
    // not as a thrown exception — so this branch is not optional.
    if (reply?.viewing_key_error) {
      return {
        status: 'unauthorized',
        message: reply.viewing_key_error.msg ?? 'The token rejected this permit.'
      }
    }

    const amount = reply?.balance?.amount
    if (typeof amount !== 'string') {
      return { status: 'error', message: `Unexpected reply: ${JSON.stringify(reply).slice(0, 160)}` }
    }

    return { status: 'ok', amount }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/unauthorized|permit|signature/i.test(message)) return { status: 'unauthorized', message }
    return { status: 'error', message }
  }
}

/**
 * Balances for several tokens at once.
 *
 * Settled rather than raced: one token whose contract is unreachable must show
 * as one unavailable row, not blank the whole list. An empty result means
 * "could not read", never "you hold nothing" — the two look identical on screen
 * and only one of them is safe to act on.
 */
export async function queryBalances(
  client: SecretNetworkClient,
  permit: Permit,
  contractAddresses: string[]
): Promise<Map<string, BalanceOutcome>> {
  const entries = await Promise.all(
    contractAddresses.map(async (address) => [address, await queryBalance(client, permit, address)] as const)
  )
  return new Map(entries)
}

export interface Transfer {
  id?: number
  from: string
  sender: string
  receiver: string
  coins: { denom: string; amount: string }
  block_time?: number
  block_height?: number
}

export async function queryTransferHistory(
  client: SecretNetworkClient,
  permit: Permit,
  contractAddress: string,
  { page = 0, pageSize = 20 }: { page?: number; pageSize?: number } = {}
): Promise<Transfer[]> {
  if (!covers(permit, contractAddress)) return []

  const codeHash = await codeHashFor(client, contractAddress)
  const reply = (await client.query.compute.queryContract({
    contract_address: contractAddress,
    code_hash: codeHash,
    query: withPermit(permit, { transfer_history: { page, page_size: pageSize } })
  })) as { transfer_history?: { txs?: Transfer[] } }

  // An empty list means nothing was found on this page — never proof that the
  // account has no history.
  return reply?.transfer_history?.txs ?? []
}

/* -------------------------------------------------------------------------- */
/* Execute messages                                                            */
/* -------------------------------------------------------------------------- */

/** Wrap native SCRT into sSCRT. The amount rides as `sent_funds`, not in the message. */
export const depositMsg = { deposit: {} } as const

/** Unwrap back to native SCRT. */
export function redeemMsg(amount: string): { redeem: { amount: string } } {
  return { redeem: { amount } }
}

export function transferMsg(
  recipient: string,
  amount: string
): { transfer: { recipient: string; amount: string } } {
  return { transfer: { recipient, amount } }
}

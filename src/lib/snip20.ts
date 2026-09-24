import type { SecretNetworkClient } from 'secretjs'

import { batchQuery } from '@/lib/batchQuery'
import { codeHashFor } from '@/lib/codeHash'
import { mapWithLimit } from '@/lib/concurrency'
import { errorMessage } from '@/lib/errors'
import { covers, withPermit, type Permit } from '@/lib/permit'

/**
 * SNIP-20 reads, authenticated one of two ways.
 *
 * A **permit** is the good way and what an ordinary account uses: a signature,
 * no transaction, no secret to look after. It names the tokens it covers, so
 * the first thing each query does is check coverage — skipping that check
 * turns "you signed before this token existed" into an opaque contract error
 * that reads like the node is broken.
 *
 * A **viewing key** is the old way, and the only way a multisig has. SNIP-24
 * verifies a permit by recovering one secp256k1 public key and comparing its
 * address; a multisig signature is an aggregate with no such key behind it, so
 * no permit a group can produce will ever be accepted. What is left is a key
 * the contract stores, set by a transaction the group signs together, and
 * shared between the members afterwards.
 *
 * The difference is worth stating where the UI can read it: a viewing key is a
 * shared secret. Anyone holding it can read the balance, it outlives the
 * membership of whoever was given it, and changing it is another transaction.
 */

/**
 * How a read proves who is asking.
 *
 * The viewing-key variant carries its own owner address, because the contract
 * has no signature to derive one from — which also means anyone can ask about
 * any address, provided they hold that address's key.
 */
export type Snip20Auth =
  { kind: 'permit'; permit: Permit } | { kind: 'viewing-key'; address: string; key: string }

export function permitAuth(permit: Permit): Snip20Auth {
  return { kind: 'permit', permit }
}

export function viewingKeyAuth(address: string, key: string): Snip20Auth {
  return { kind: 'viewing-key', address, key }
}

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

/** A balance reply, read into an outcome. */
function balanceOutcome(reply: BalanceReply | undefined): BalanceOutcome {
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
}

function balanceQuery(auth: Snip20Auth): object {
  return auth.kind === 'permit'
    ? withPermit(auth.permit, { balance: {} })
    : { balance: { address: auth.address, key: auth.key } }
}

export async function queryBalance(
  client: SecretNetworkClient,
  auth: Snip20Auth,
  contractAddress: string
): Promise<BalanceOutcome> {
  if (auth.kind === 'permit' && !covers(auth.permit, contractAddress)) return { status: 'not-covered' }

  try {
    const codeHash = await codeHashFor(client, contractAddress)
    const reply = (await client.query.compute.queryContract({
      contract_address: contractAddress,
      code_hash: codeHash,
      query: balanceQuery(auth)
    })) as BalanceReply

    return balanceOutcome(reply)
  } catch (error) {
    // Via the helper: a contract rejecting the permit comes back as secretjs's
    // thrown JSON body, which "[object Object]" hid — classifying a permit
    // problem as a generic error, so the screen never offered to re-sign.
    const message = errorMessage(error)
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
  auth: Snip20Auth,
  contractAddresses: string[]
): Promise<Map<string, BalanceOutcome>> {
  const entries = await Promise.all(
    contractAddresses.map(async (address) => [address, await queryBalance(client, auth, address)] as const)
  )
  return new Map(entries)
}

/**
 * Balances for many tokens through the batch router, a handful per request.
 *
 * Only worth it where the query can travel as a request body — the gRPC path
 * (`lib/grpcQuery.ts`): a permit is several kB, and through the LCD's URL each
 * one goes alone anyway (`lib/batchQuery.ts`). A token that could not be read
 * this way says so in its outcome, and the caller reads it on its own.
 */
export async function queryBalancesBatched(
  client: SecretNetworkClient,
  auth: Snip20Auth,
  contractAddresses: string[],
  onProgress?: (done: number, total: number) => void
): Promise<Map<string, BalanceOutcome>> {
  const outcomes = new Map<string, BalanceOutcome>()
  const asked = contractAddresses.filter((address) => {
    if (auth.kind === 'permit' && !covers(auth.permit, address)) {
      outcomes.set(address, { status: 'not-covered' })
      return false
    }
    return true
  })

  const hashes = new Map<string, string>()
  await mapWithLimit(asked, 12, async (address) => {
    const hash = await codeHashFor(client, address).catch(() => undefined)
    if (hash) hashes.set(address, hash)
  })

  const query = balanceQuery(auth)
  const answers = await batchQuery(
    client,
    asked
      .filter((address) => hashes.has(address))
      .map((address) => ({ id: address, contract: { address, codeHash: hashes.get(address)! }, query })),
    // Each permit is checked by signature inside the router's one query; ten
    // stays well inside a node's query gas, and a refused batch is halved.
    { size: 10, onChunk: onProgress }
  )

  for (const address of asked) {
    const answer = answers.get(address)
    if (!answer) outcomes.set(address, { status: 'error', message: 'No answer.' })
    else if (answer.ok) outcomes.set(address, balanceOutcome(answer.value as BalanceReply))
    else if (/unauthorized|permit|signature/i.test(answer.error)) {
      outcomes.set(address, { status: 'unauthorized', message: answer.error })
    } else outcomes.set(address, { status: 'error', message: answer.error })
  }
  return outcomes
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
  auth: Snip20Auth,
  contractAddress: string,
  { page = 0, pageSize = 20 }: { page?: number; pageSize?: number } = {}
): Promise<Transfer[]> {
  if (auth.kind === 'permit' && !covers(auth.permit, contractAddress)) return []

  const codeHash = await codeHashFor(client, contractAddress)
  const reply = (await client.query.compute.queryContract({
    contract_address: contractAddress,
    code_hash: codeHash,
    query:
      auth.kind === 'permit'
        ? withPermit(auth.permit, { transfer_history: { page, page_size: pageSize } })
        : {
            transfer_history: {
              address: auth.address,
              key: auth.key,
              page,
              page_size: pageSize
            }
          }
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

/**
 * Store a viewing key at the contract.
 *
 * `set_viewing_key` rather than `create_viewing_key`: the contract's own
 * generator returns the key in the encrypted reply, which works but leaves the
 * key unknown until the transaction lands — awkward for a group, where the
 * point is that everyone can read the balance afterwards. A key generated here
 * is in the proposal every member already has.
 */
export function setViewingKeyMsg(key: string): { set_viewing_key: { key: string } } {
  return { set_viewing_key: { key } }
}

/**
 * A key with enough entropy that guessing it is not a strategy.
 *
 * Prefixed the way SNIP-20 contracts prefix their own, so a key set by this
 * app is recognisable as one among a wallet's other keys.
 */
export function generateViewingKey(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `api_key_${btoa(binary)}`
}

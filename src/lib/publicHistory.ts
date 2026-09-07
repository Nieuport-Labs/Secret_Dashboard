/**
 * The public half of an account's history, read from the chain's transaction
 * index.
 *
 * SNIP-20 movements are encrypted in contract state and only a permit opens
 * them (see `queryTransferHistory`). Everything in the bank module is the
 * opposite: `uscrt` and the `ibc/…` vouchers move in plain sight, an explorer
 * shows them to anyone, and no permit is involved. A wallet that lists only the
 * private half is telling half the story — and the public half is the half the
 * user most needs to act on, since it is the money that is not private yet.
 *
 * Read over the LCD directly rather than through secretjs's `txsQuery`: that
 * method sends the search as repeated `events=` parameters, which secret-4's
 * nodes answer with "query cannot be empty". They take the newer single
 * `query=` parameter instead. Verified against both default endpoints; see
 * docs/chain-facts.md.
 */

const TIMEOUT_MS = 15_000

export interface PublicTransfer {
  hash: string
  height: number
  /** Seconds since the epoch. */
  at?: number
  /** `uscrt` or an `ibc/…` voucher. */
  denom: string
  /** Base units. */
  amount: string
  counterparty: string
  direction: 'in' | 'out'
  /**
   * The transaction also moved a packet across a chain boundary, so this is a
   * bridge leg rather than a payment between two Secret accounts.
   */
  ibc: boolean
}

interface TxEvent {
  type: string
  attributes: { key: string; value: string }[]
}

interface TxResponse {
  txhash: string
  height: string
  timestamp: string
  code: number
  events?: TxEvent[]
  tx?: { body?: { messages?: { '@type'?: string }[] } }
}

const MSG_TRANSFER_TYPE = '/ibc.applications.transfer.v1.MsgTransfer'

/**
 * Cosmos writes an amount as a coin string — `1000uscrt` — and several coins in
 * one attribute as a comma-separated list of them.
 */
function parseCoins(value: string): { denom: string; amount: string }[] {
  const coins: { denom: string; amount: string }[] = []
  for (const part of value.split(',')) {
    const match = /^(\d+)(.+)$/.exec(part.trim())
    if (match) coins.push({ amount: match[1], denom: match[2] })
  }
  return coins
}

function attribute(event: TxEvent, key: string): string | undefined {
  return event.attributes.find((entry) => entry.key === key)?.value
}

function transfersIn(tx: TxResponse, address: string): PublicTransfer[] {
  const at = Date.parse(tx.timestamp)
  const ibc =
    (tx.tx?.body?.messages ?? []).some((message) => message['@type'] === MSG_TRANSFER_TYPE) ||
    (tx.events ?? []).some((event) => event.type === 'recv_packet')

  const found: PublicTransfer[] = []

  for (const event of tx.events ?? []) {
    if (event.type !== 'transfer') continue

    /*
     * The fee payment is a transfer too — from the payer to the fee collector,
     * emitted by the ante handler before any message runs. It is not something
     * anyone means by "activity", and it would otherwise appear on every single
     * transaction the account ever signed. Ante-handler events carry no
     * `msg_index`; events emitted while executing a message do. That is the
     * distinction, rather than matching the fee collector's address, which is a
     * constant that can be renumbered.
     */
    if (attribute(event, 'msg_index') === undefined) continue

    const sender = attribute(event, 'sender')
    const recipient = attribute(event, 'recipient')
    const amount = attribute(event, 'amount')
    if (!sender || !recipient || !amount) continue

    const direction = recipient === address ? 'in' : sender === address ? 'out' : undefined
    if (!direction) continue

    for (const coin of parseCoins(amount)) {
      found.push({
        hash: tx.txhash,
        height: Number(tx.height),
        at: Number.isNaN(at) ? undefined : Math.floor(at / 1000),
        denom: coin.denom,
        amount: coin.amount,
        counterparty: direction === 'in' ? sender : recipient,
        direction,
        ibc
      })
    }
  }

  return found
}

async function search(lcdUrl: string, query: string, limit: number): Promise<TxResponse[]> {
  const url = new URL(`${lcdUrl.replace(/\/+$/, '')}/cosmos/tx/v1beta1/txs`)
  url.searchParams.set('query', query)
  url.searchParams.set('order_by', 'ORDER_BY_DESC')
  url.searchParams.set('pagination.limit', String(limit))

  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)

  const body = (await response.json()) as { tx_responses?: TxResponse[] }
  return body.tx_responses ?? []
}

/**
 * Public transfers into and out of `address`, newest first.
 *
 * Two searches, because one index entry cannot answer both directions: a
 * transfer names a sender and a recipient, and the account is only ever one of
 * them. Transactions found by both are folded together — the same movement
 * seen twice is still one movement.
 */
export async function queryPublicTransfers(
  lcdUrl: string,
  address: string,
  limit = 20
): Promise<PublicTransfer[]> {
  const [incoming, outgoing] = await Promise.all([
    search(lcdUrl, `transfer.recipient='${address}'`, limit),
    search(lcdUrl, `transfer.sender='${address}'`, limit)
  ])

  const found = new Map<string, PublicTransfer>()

  for (const tx of [...incoming, ...outgoing]) {
    // A failed transaction moved nothing but the fee, and the fee is already
    // excluded above.
    if (tx.code !== 0) continue

    transfersIn(tx, address).forEach((transfer, index) => {
      found.set(`${transfer.hash}:${index}:${transfer.denom}:${transfer.direction}`, transfer)
    })
  }

  return [...found.values()].sort((a, b) => b.height - a.height)
}

/**
 * Watching for public (bank module) transfers.
 *
 * SNIP-52 covers private tokens only, because it exists to reveal something the
 * chain deliberately hides. A bank transfer hides nothing: the amount, sender
 * and recipient are in the transaction log for anyone to read. So it needs no
 * cryptography, just a Tendermint subscription filtering on the recipient.
 *
 * Which makes it the moment worth acting on. A public token sitting on Secret
 * is visible to everyone, and the arrival is exactly when the holder knows what
 * it is and why they have it — so this is what drives the "do you want to wrap
 * it?" offer.
 */

let neutrino: Promise<typeof import('@solar-republic/neutrino')> | undefined
function loadNeutrino() {
  neutrino ??= import('@solar-republic/neutrino')
  return neutrino
}

export interface BankReceipt {
  /** e.g. `uscrt`, or an `ibc/…` voucher denomination. */
  denom: string
  /** Base units. */
  amount: string
  sender?: string
}

/**
 * Cosmos writes transfer amounts as a single `amount` attribute holding a
 * concatenated coin string: `1000uscrt` or `500ibc/ABC…`. Splitting on the
 * digit/letter boundary is the documented way to read it.
 */
function parseCoin(value: string): BankReceipt | undefined {
  const match = /^(\d+)(.+)$/.exec(value.trim())
  if (!match) return undefined
  return { amount: match[1], denom: match[2] }
}

export interface WatchOptions {
  rpcUrl: string
  address: string
  onReceipt: (receipt: BankReceipt) => void
}

/**
 * @returns a function that stops listening.
 */
export async function watchBankReceipts({ rpcUrl, address, onReceipt }: WatchOptions): Promise<() => void> {
  const { TendermintEventFilter } = await loadNeutrino()

  const filter = await TendermintEventFilter(rpcUrl as `https://${string}`)

  return filter.when('transfer.recipient', address, (_data, events) => {
    // A transaction can carry several transfers, and only some of them are
    // ours. The attribute arrays are positional, so the amount at index i
    // belongs to the recipient at index i.
    const recipients = events['transfer.recipient'] ?? []
    const amounts = events['transfer.amount'] ?? []
    const senders = events['transfer.sender'] ?? []

    recipients.forEach((recipient, index) => {
      if (recipient !== address) return
      const coin = parseCoin(amounts[index] ?? '')
      if (coin) onReceipt({ ...coin, sender: senders[index] })
    })
  })
}

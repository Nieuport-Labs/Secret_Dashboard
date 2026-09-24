import type { Msg, SecretNetworkClient } from 'secretjs'

import { GAS } from '@/chains/secret4'
import { codeHashFor } from '@/lib/codeHash'
import type { InvoiceAsset } from '@/lib/invoice'
import { MSG_EXECUTE_CONTRACT, MSG_SEND } from '@/lib/msgTypes'
import { swapGas, swapMessage, type Quote } from '@/lib/shadeSwap'
import { redeemMsg, transferMsg } from '@/lib/snip20'
import { tokenAddressForBankDenom } from '@/tokens/routes'

/**
 * Paying an invoice with something other than what it asks for.
 *
 * The invoice still decides what arrives: the recipient gets exactly its
 * amount of its asset, whatever the payer spent. Everything happens in one
 * transaction, so it either all lands or none of it does.
 *
 * Everything goes through the invoice asset's SNIP-20 — the asset itself when
 * the invoice is private, or the token its public denomination wraps into
 * (`tokenAddressForBankDenom`) when it is public:
 *
 * - `direct`: the asset itself, sent as it is — the ordinary payment;
 * - `unwrap`: a public invoice paid from the private form of the same asset —
 *   unwrapped, then sent;
 * - `swap`: any other private token, swapped for that SNIP-20 on ShadeSwap
 *   with the invoice amount as the minimum return, then sent as the invoice
 *   asks (unwrapped first when it asks for the public form).
 */

export type PaySource =
  { kind: 'direct' } | { kind: 'unwrap' } | { kind: 'swap'; token: string; quote: Quote }

/** The SNIP-20 an invoice is settled through, or `undefined` for a denomination nothing wraps. */
export function settlementToken(asset: InvoiceAsset): string | undefined {
  return asset.private ? asset.id : tokenAddressForBankDenom(asset.id)
}

export interface PaymentPlan {
  messages: Msg[]
  gasLimit: number
  msgTypes: string[]
}

export async function paymentMessages(
  client: SecretNetworkClient,
  sender: string,
  to: string,
  asset: InvoiceAsset,
  amount: bigint,
  source: PaySource
): Promise<PaymentPlan> {
  const { MsgExecuteContract, MsgSend } = await import('secretjs')
  const bankSend = () =>
    new MsgSend({
      from_address: sender,
      to_address: to,
      amount: [{ denom: asset.id, amount: amount.toString() }]
    })

  if (source.kind === 'direct') {
    if (!asset.private) return { messages: [bankSend()], gasLimit: GAS.send, msgTypes: [MSG_SEND] }
    return {
      messages: [
        new MsgExecuteContract({
          sender,
          contract_address: asset.id,
          code_hash: await codeHashFor(client, asset.id),
          msg: transferMsg(to, amount.toString()),
          sent_funds: []
        })
      ],
      gasLimit: GAS.snip20Transfer,
      msgTypes: [MSG_EXECUTE_CONTRACT]
    }
  }

  const token = settlementToken(asset)
  if (!token) throw new Error('This invoice asks for an asset that cannot be paid another way.')
  const codeHash = await codeHashFor(client, token)

  const messages: Msg[] = []
  const msgTypes: string[] = []
  let gasLimit = 0

  if (source.kind === 'swap') {
    // At least the invoice amount comes back, or the router refuses the trade.
    messages.push(await swapMessage(sender, source.quote.route, source.quote.amountIn, amount))
    msgTypes.push(MSG_EXECUTE_CONTRACT)
    gasLimit += swapGas(source.quote.route)
  }

  if (asset.private) {
    messages.push(
      new MsgExecuteContract({
        sender,
        contract_address: token,
        code_hash: codeHash,
        msg: transferMsg(to, amount.toString()),
        sent_funds: []
      })
    )
    msgTypes.push(MSG_EXECUTE_CONTRACT)
    gasLimit += GAS.snip20Transfer
  } else {
    messages.push(
      new MsgExecuteContract({
        sender,
        contract_address: token,
        code_hash: codeHash,
        msg: redeemMsg(amount.toString()),
        sent_funds: []
      }),
      bankSend()
    )
    msgTypes.push(MSG_EXECUTE_CONTRACT, MSG_SEND)
    gasLimit += GAS.unwrap + GAS.send
  }

  return { messages, gasLimit, msgTypes }
}

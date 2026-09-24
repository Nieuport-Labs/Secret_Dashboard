import type { Msg } from 'secretjs'

import { DENOM, GAS, GAS_VAULT_ADDRESS } from '@/chains/secret4'
import { codeHashFor } from '@/lib/codeHash'
import { loadPermit } from '@/lib/permit'
import { permitAuth, queryBalance, redeemMsg } from '@/lib/snip20'
import { useFeePayer, vaultCredit } from '@/store/feePayer'
import { useNotifications } from '@/store/notifications'
import { useSettings } from '@/store/settings'
import { useWallet } from '@/store/wallet'
import { SSCRT_ADDRESS } from '@/tokens/registry'

/**
 * Auto-refill of gas credits: the `autorefill` answer to the first-run
 * question, carried out.
 *
 * Whenever the account's gas credits are below 5 SCRT, the next transaction
 * it sends through `sendTx` carries two more messages: unwrap up to 5 sSCRT,
 * and pay the SCRT that frees straight into the gas vault for this address.
 * Both run inside the same transaction, after the user's own messages, so the
 * refill costs no extra prompt. With less than 5 sSCRT it refills with all
 * there is; with none, it says where to get some instead.
 *
 * The same rules as the profile write that also rides along (see `sendTx`):
 * the refill must never be why someone's own transaction failed. So it is left
 * off whenever it would change who pays the fee, and a bundle that fails
 * because of it is sent again without it.
 */

/** Refill below this, and by this much. 5 SCRT, in base units. */
export const CREDIT_FLOOR = 5_000_000n

export const REFILL_GAS = GAS.unwrap + GAS.buyGasCredit

export const SHADE_SWAP_URL = 'https://app.shadeprotocol.io/swap'

/**
 * A refill just sent (or just refused) is not tried again for a while: the
 * grant list takes a moment to show the new credit, and a second transaction
 * sent in that moment would otherwise refill twice.
 */
const COOLDOWN_MS = 2 * 60_000
/** How often the "no sSCRT to refill with" notice may come back. */
const NOTICE_EVERY_MS = 30 * 60_000

let pausedUntil = 0
let noticedAt = 0

export function pauseRefill(): void {
  pausedUntil = Date.now() + COOLDOWN_MS
}

export interface Refill {
  messages: Msg[]
  gas: number
  /** Base units of SCRT that go to the vault. */
  amount: bigint
}

/** How much to refill with, given the credit left and the sSCRT held. Zero means nothing to refill with. */
export function refillAmount(credit: bigint, sscrt: bigint): bigint | undefined {
  if (credit >= CREDIT_FLOOR) return undefined
  return sscrt < CREDIT_FLOOR ? sscrt : CREDIT_FLOOR
}

function noticeNoSscrt(): void {
  if (Date.now() - noticedAt < NOTICE_EVERY_MS) return
  noticedAt = Date.now()
  useNotifications.getState().push({
    kind: 'gas-empty',
    message:
      'Your gas credits are below 5 and there is no sSCRT to refill them with. You can get SCRT/sSCRT on Shade Swap.'
  })
}

/**
 * The refill for this account's next transaction, or `undefined` when none is
 * due or it cannot be worked out. Anything it cannot read — the grant list, the
 * sSCRT balance — means no refill rather than a guess.
 */
export async function refillFor(address: string): Promise<Refill | undefined> {
  if (useSettings.getState().gasMode !== 'autorefill') return undefined
  if (Date.now() < pausedUntil) return undefined

  const { queryClient } = useWallet.getState()
  if (!queryClient) return undefined

  // Fresh, not whatever the header last read: this decides whether SCRT moves.
  await useFeePayer.getState().refresh()
  const { grants, error } = useFeePayer.getState()
  if (error) return undefined
  const credit = vaultCredit(grants) ?? 0n
  if (credit >= CREDIT_FLOOR) return undefined

  // sSCRT is private, so its balance needs the permit. Without one there is
  // no way to know what is there, and the refill waits until there is.
  const permit = loadPermit(address)
  if (!permit) return undefined
  const balance = await queryBalance(queryClient, permitAuth(permit), SSCRT_ADDRESS)
  if (balance.status !== 'ok') return undefined

  const amount = refillAmount(credit, BigInt(balance.amount))
  if (amount === undefined) return undefined
  if (amount === 0n) {
    noticeNoSscrt()
    return undefined
  }

  const { MsgExecuteContract } = await import('secretjs')
  const [sscrtHash, vaultHash] = await Promise.all([
    codeHashFor(queryClient, SSCRT_ADDRESS),
    codeHashFor(queryClient, GAS_VAULT_ADDRESS)
  ])

  return {
    amount,
    gas: REFILL_GAS,
    messages: [
      new MsgExecuteContract({
        sender: address,
        contract_address: SSCRT_ADDRESS,
        code_hash: sscrtHash,
        msg: redeemMsg(amount.toString()),
        sent_funds: []
      }),
      // Runs after the unwrap above has put the SCRT in the bank balance.
      new MsgExecuteContract({
        sender: address,
        contract_address: GAS_VAULT_ADDRESS,
        code_hash: vaultHash,
        msg: { grant: { grantee: address } },
        sent_funds: [{ denom: DENOM, amount: amount.toString() }]
      })
    ]
  }
}

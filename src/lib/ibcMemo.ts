import { GAS_VAULT_ADDRESS, IBC_HOOKS_WRAPPER } from '@/chains/secret4'
import { CROSSCHAIN_SWAPS_CONTRACT, OSMOSIS_TO_SECRET_CHANNEL, SCRT_ON_OSMOSIS } from '@/chains/osmosis'

/**
 * ICS-20 memos, and the constraints that make them work.
 *
 * Two rules from Secret's `x/ibc-hooks` shape every memo here, both verified
 * (docs/chain-facts.md):
 *
 * 1. **`receiver` must equal `memo.wasm.contract`.** The packet's ICS-20
 *    receiver field and the contract named in the memo have to be the same
 *    address. So a packet that runs a hook is addressed *to the contract*, and
 *    the human it is ultimately for travels inside `msg`. Getting this backwards
 *    produces a packet the hook silently declines to run.
 * 2. **The contract sees a null sender.** An IBC sender cannot be verified
 *    across chains, so `info.sender` is null inside the hook. Any contract
 *    targeted this way must not depend on it.
 *
 * Because of rule 1, every builder here returns the receiver alongside the
 * memo. They are not independent choices and must not be set separately.
 */

export interface HookedTransfer {
  /** The ICS-20 `receiver` field. Not the end user when a hook is involved. */
  receiver: string
  /** The ICS-20 `memo` field, already serialised. */
  memo: string
}

/**
 * Wrap an arriving token into its SNIP-20 the moment it lands.
 *
 * The alternative is that it sits on Secret as a public IBC voucher, visible to
 * anyone, until the holder notices and wraps it by hand.
 *
 * @param codeHash must be read from the chain, never stored. A contract query is
 *   encrypted against it, and a stale one does not degrade — it fails outright.
 */
export function wrapDepositMemo(snip20Address: string, codeHash: string, recipient: string): HookedTransfer {
  return {
    receiver: IBC_HOOKS_WRAPPER,
    memo: JSON.stringify({
      wasm: {
        contract: IBC_HOOKS_WRAPPER,
        msg: {
          wrap_deposit: {
            snip20_address: snip20Address,
            snip20_code_hash: codeHash,
            recipient_address: recipient
          }
        }
      }
    })
  }
}

/**
 * Make the gas vault issue `grantee` a fee allowance from the SCRT in this
 * packet.
 *
 * This is what lets someone arriving with nothing become able to transact
 * without ever signing anything on Secret. It works because the vault's `grant`
 * handler reads only `info.funds`, `env.contract.address` and the grantee from
 * the message — never `info.sender`, which the hook nulls out.
 */
export function gasCreditMemo(grantee: string): HookedTransfer {
  return {
    receiver: GAS_VAULT_ADDRESS,
    memo: JSON.stringify({
      wasm: {
        contract: GAS_VAULT_ADDRESS,
        msg: { grant: { grantee } }
      }
    })
  }
}

/**
 * A transfer with no hook.
 *
 * The reference dashboard sends a single space rather than an empty string here,
 * with a note about IBC hook logic dropping the signer when a memo is present.
 * The mechanism is not explained there and I could not reproduce it, so the
 * plain empty memo is used — which is what every wallet sends for an ordinary
 * transfer. If signing ever fails on a specific chain, this is the first thing
 * to try changing back.
 */
export function plainTransfer(receiver: string): HookedTransfer {
  return { receiver, memo: '' }
}

/* -------------------------------------------------------------------------- */
/* Osmosis crosschain swaps                                                    */
/* -------------------------------------------------------------------------- */

export type Slippage = { twap: { slippage_percentage: string; window_seconds: number } }

export interface SwapToSecretOptions {
  /** Where the swapped SCRT should land on Secret. */
  secretReceiver: string
  /** The user's own osmo1 address, so a failed delivery is recoverable. */
  recoveryAddress: string
  /** Attached to the packet that reaches Secret. */
  secretMemo?: string
  slippagePercent?: number
}

/**
 * Memo that makes Osmosis swap an arriving token into SCRT and forward it to
 * Secret.
 *
 * `next_memo` is the slot that reaches Secret, not `final_memo`. SCRT on Osmosis
 * is `transfer/channel-88/uscrt`, so sending it back to Secret is a one-hop
 * unwind and the contract's `first_transfer_memo` is the only memo there is.
 * Read out of the contract source rather than guessed; see docs/chain-facts.md.
 *
 * `on_failed_delivery` is always a recovery address, never `do_nothing`. With
 * `do_nothing` the contract does not track the packet at all, and a failed
 * delivery leaves the funds unreachable.
 */
export function osmosisSwapToSecretMemo({
  secretReceiver,
  recoveryAddress,
  secretMemo,
  slippagePercent = 5
}: SwapToSecretOptions): HookedTransfer {
  return {
    // Rule 1 again, one chain earlier: the packet arriving on Osmosis is
    // addressed to the swap contract, and where it ends up is in the message.
    receiver: CROSSCHAIN_SWAPS_CONTRACT,
    memo: JSON.stringify({
      wasm: {
        contract: CROSSCHAIN_SWAPS_CONTRACT,
        msg: {
          osmosis_swap: {
            output_denom: SCRT_ON_OSMOSIS,
            receiver: secretReceiver,
            slippage: {
              twap: { slippage_percentage: String(slippagePercent), window_seconds: 10 }
            } satisfies Slippage,
            on_failed_delivery: { local_recovery_addr: recoveryAddress },
            next_memo: secretMemo ? (JSON.parse(secretMemo) as unknown) : null
          }
        }
      }
    })
  }
}

/** The channel Osmosis forwards over, for display and for verification. */
export const OSMOSIS_RETURN_CHANNEL = OSMOSIS_TO_SECRET_CHANNEL

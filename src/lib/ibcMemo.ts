import { IBC_HOOKS_WRAPPER } from '@/chains/secret4'

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

/*
 * The gas leg's swap-and-forward memo used to live here, addressed to
 * Osmosis's `crosschain-swaps` contract. It is gone: that contract resolves a
 * bare Secret receiver through a hand-maintained, governor-only pool list that
 * was never given an entry for anything but `OSMO → SCRT`, so a live packet
 * bridging USDC failed with "No route found" — see docs/chain-facts.md. The
 * gas leg is now planned through Skip's routing API instead; see
 * `lib/skipGo.ts`. `wrapDepositMemo` above is unaffected — it hits a different
 * contract entirely, one this app owns the deployment relationship with.
 */

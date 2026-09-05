# Chain facts

What `scripts/verify-chain.ts` and manual source reading established against **secret-4**,
before any UI was written. Everything here is a fact the build depends on, so re-run
`npm run verify:chain` when something behaves unexpectedly rather than assuming this is current.

Verified **2026-09-06**. Result: 10 pass, 1 warn (deliberate), 0 fail.

---

## Endpoints

Public Secret infrastructure is thinner than the chain registry suggests. Of fourteen LCD and
twelve RPC candidates probed, these answered with JSON **and** reported `secret-4`:

| Kind | URL                                               |
| ---- | ------------------------------------------------- |
| LCD  | `https://lcd-secret.keplr.app`                    |
| LCD  | `https://rest.lavenderfive.com:443/secretnetwork` |
| LCD  | `https://secretnetwork-api.lavenderfive.com`      |
| RPC  | `https://rpc-secret.keplr.app`                    |
| RPC  | `https://rpc.lavenderfive.com:443/secretnetwork`  |

Two providers, effectively. Settings must let a user paste their own endpoint, because this is
not enough redundancy to rely on.

**Probing is not paranoia.** `https://public.stakewolle.com/cosmos/secretnetwork/rest` is listed
in the cosmos chain-registry under Secret and answers happily — reporting chain `axone-1`. A
client that trusted the registry would query an unrelated chain and show its results as Secret's.
Other candidates returned HTTP 403, expired certificates, or HTML that parses as
`Unexpected token '<'` from inside secretjs. Accept an endpoint only when it returns JSON and
names `secret-4`.

**WebSocket** (the transport SNIP-52 push depends on): `wss://rpc-secret.keplr.app/websocket`
accepts a `tm.event='NewBlock'` subscription.

## Gas

|                                  |                                                          |
| -------------------------------- | -------------------------------------------------------- |
| Node reports `minimum_gas_price` | `0.0125 uscrt`                                           |
| Chain registry                   | fixed min `0.05`, low `0.05`, average `0.1`, high `0.25` |
| **What the app uses**            | **`0.1 uscrt`**                                          |

0.1 is deliberate, not laziness. The fee estimate handed to `selectFeeGrant` must be **at least**
what is actually paid: estimating low makes a grant look able to cover a transaction it then
fails, which is the one failure mode the fee-grant SDK cannot recover from. Estimating high only
risks judging a grant insufficient when it would have paid — a false negative that falls back to
the wallet's own balance, which is safe. Node minimums also vary per validator, and 0.1 clears
all of them.

## Gas vault — live on mainnet

The fee-granter's own notes said the vault was _"not yet exercised on secret-4"_. It is now:

```
address    secret1kkmu4vydkppkhzmx00glm20vn47t09544adv0g
code hash  d36c886d54358bb270f51d81568af89c2fccfd0303be3eb0b844facaa3656fa0
balance    11874000 uscrt (11.874 SCRT)
```

The balance is also the sum of every allowance it has issued and not seen spent — the two cannot
drift, so this single figure says whether its grants are backed.

**Gas credits ship as planned; no fallback needed.**

## SNIP-52 — sSCRT has channels

```
sSCRT      secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek
code hash  c8ac20dce1aaf573a27bba8a765b4cd8d3be8d7ed921210b80a0f9563b9315b2
channels   recvd, spent, allowance, multirecvd, multispent
```

`recvd` and `spent` are single-recipient channels (counter or txhash mode); `multirecvd` and
`multispent` are bloom-mode, for transactions touching several recipients at once. `allowance`
covers SNIP-20 allowance changes.

Every token in the registry needs the same query before it is subscribed — coverage is per
contract, not chain-wide, because only migrated contracts carry `notifications.rs`. Tokens
without channels stay on polling, and the UI says which is which rather than pretending.

## SNIP-24 — permits work

A structurally valid permit carrying a deliberately wrong signature was rejected with
`Generic error: Invalid public key format` — meaning the contract parsed `with_permit` and got
as far as verifying the signature. A contract without SNIP-24 fails much earlier, with an
unknown-variant error. Viewing keys can go.

(A _null_ permit proves nothing here: it only shows malformed JSON was rejected. The probe has
to reach signature verification to be evidence.)

## Auto-restake

```
minimum_restake_threshold   10000000 uscrt = 10 SCRT
restake_period              1000
```

Read from `/cosmos/distribution/v1beta1/params`, not hardcoded. Below 10 SCRT delegated to a
validator, `MsgSetAutoRestake` is pointless for that validator and the UI must say so instead of
offering a toggle that silently does nothing.

## IBC hooks

The auto-wrap proxy the reference dashboard targets is alive and unmigrated:

```
address    secret198lmmh2fpj3weqhjczptkzl9pxygs23yn6dsev
label      ibc-hooks-snip20-auto-wrap-proxy-contract
code id    1280
code hash  a6c421e3a60cf0e17931945b60d229eb4b4fce5f452122f34412cb937375ee27
```

Two constraints from Secret's `x/ibc-hooks` that shape every memo we build:

1. **`receiver` must equal `memo.wasm.contract`.** The ICS-20 receiver field and the contract
   named in the memo have to be the same address. So a hook that grants gas credits is addressed
   _to the vault_, and the user's address travels inside `msg`, not in `receiver`.
2. **The contract sees a null sender.** An IBC sender cannot be verified cross-chain, so
   `info.sender` is null. Any contract we target through a hook must not depend on it.

A failed contract execution returns `ErrAck`, so the packet fails and funds unwind back along
the path rather than sticking on Secret.

### The gas vault survives a null sender

Checked by reading `contracts/gas-vault/src/contract.rs` in `jirkacepelka/fee-granter`, not
inferred. `fn grant` uses only `info.funds`, `env.contract.address` and the `grantee` from the
message. It never reads `info.sender`.

**So variant A of "Get gas" is viable** — an incoming IBC packet can make the vault issue the
user a fee allowance with no Secret-side signature from the user at all. Corrected memo shape:

```jsonc
// ICS-20 receiver MUST be the vault address, not the user's
{
  "wasm": {
    "contract": "secret1kkmu4vydkppkhzmx00glm20vn47t09544adv0g",
    "msg": { "grant": { "grantee": "secret1<user>" } }
  }
}
```

`ExecuteMsg::Grant { grantee }` rejects a message with no SCRT attached
(`"send SCRT with this message"`), and tops up an existing grant by revoking and re-granting in
one transaction — so a repeat purchase is safe.

## Osmosis leg (for "Get gas")

|                  |                                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------- |
| SCRT on Osmosis  | `ibc/0954E1C28EB7AF5B72D24F3BC2B47BBB2FDF91BDDFD57B74B99E133AED40972A` (`transfer/channel-88/uscrt`)     |
| Osmosis → Secret | `channel-88`, counterparty client reports `secret-4`                                                     |
| Crosschain swaps | `osmo1uwk8xc6q0s6t5qcpr6rht3sczu6du83xq8pwxjua0hfj5hzcnh3sqxwvxs`, label `CrossChainSwaps v1.2`, code 37 |

The address widely quoted online for XCS
(`osmo1efakw4was99usxve258p58a5a26f0yt072gvyej5zr4lv5r0hxqqsddqgg`) **does not exist on
mainnet** — the LCD returns `no such contract`. Resolve deployed addresses by querying, never
from prose.

Open for Phase 6: the label says `v1.2`, and the XCS README distinguishes v1 from v2 by whether
the contract keeps its own channel/denom registry. Which lineage this is decides whether
`next_memo` and automatic unwinding are available, so read its schema before building on it.
Route planning goes through `@skip-go/client` regardless; XCS direct is the fallback.

## Axelar bridge — still down

```
address   secret1yxjmepvyl2c25vnt53cr2dpn8amknwausxee83
label     ics20-1680181216721
code id   2446
```

The modified CW20-ICS20 fork drained for ~$4.67M on 2026-06-10: it minted wrapped tokens without
verifying the source channel of incoming IBC packets, so forged deposits over an attacker-run
channel minted unbacked saTokens. Axelar's emergency committee disabled the Secret↔Axelar
connections and the routes remain off.

The reference dashboard still ships `@axelar-network/axelarjs-sdk` and Axelar deposit-address
logic. **Do not carry it over.** saUSDT, saUSDC, saDAI, saWETH, saWBTC, saWBNB and sawstETH are
not offered as bridgeable until the route is restored.

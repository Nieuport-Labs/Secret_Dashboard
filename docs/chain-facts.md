# Chain facts

What `scripts/verify-chain.ts` and manual source reading established against **secret-4**,
before any UI was written. Everything here is a fact the build depends on, so re-run
`npm run verify:chain` when something behaves unexpectedly rather than assuming this is current.

Verified **2026-09-06**. Result: 12 pass, 1 warn (deliberate), 0 fail.

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

## The Tendermint event stream (what SNIP-52 rides on)

Both working RPC endpoints proxy the WebSocket event stream, for blocks and for
transactions:

| Query                 | keplr.app      | lavenderfive   |
| --------------------- | -------------- | -------------- |
| `tm.event='NewBlock'` | 3 events / 18s | 3 events / 18s |
| `tm.event='Tx'`       | 1 event / 30s  | 1 event / 30s  |

**Mainnet traffic is sparse**, and that is the fact that shapes the feature. A
first probe saw zero transactions in 25 seconds and looked exactly like a broken
endpoint. It was not. Blocks arrive every ~6s regardless of traffic, which is the
check that tells a dead subscription from a quiet chain.

The consequence for the UI: silence is ambiguous. "Nothing arrived" and "the
socket died half an hour ago" look identical, so the balance list states which
mode it is in, and balances are re-read on a timer whatever the socket is doing.

A captured mainnet transaction confirms the attribute shape the public-receipt
watcher depends on: `transfer.recipient`, `transfer.amount` and `transfer.sender`
arrive as **positional arrays**, one entry per transfer, and a single transaction
commonly carries several (the sampled one carried two, only one of them for the
address being watched). Amounts are concatenated coin strings — `3126uscrt`.

## neutrino

Loads in ~15ms and works against these endpoints unchanged: `SecretContract`
resolves sSCRT to code hash `c8ac20dc…`, matching what the chain reports, and
`TendermintEventFilter` opens a socket reaching `readyState 1`.

Worth knowing before reimplementing any of it: the `recvd` channel is a
**sequenced binary schema**, not CBOR, and its CDDL differs between contract
builds — one ships `sender:bstr .size 20`, another `.size 54`. The schema has to
be read from `channel_info` at runtime; it cannot be hardcoded.

## SNIP-24 — permits work

A structurally valid permit carrying a deliberately wrong signature was rejected with
`Generic error: Invalid public key format` — meaning the contract parsed `with_permit` and got
as far as verifying the signature. A contract without SNIP-24 fails much earlier, with an
unknown-variant error. Viewing keys can go.

(A _null_ permit proves nothing here: it only shows malformed JSON was rejected. The probe has
to reach signature verification to be evidence.)

The same probe confirms the `transfer_history` query shape the wallet screen sends: wrapped in
`with_permit` with `page` and `page_size`, it is parsed and rejected on the signature rather than
as an unknown variant.

## Auto-restake

```
minimum_restake_threshold   10000000 uscrt = 10 SCRT
restake_period              1000
```

Read from `/cosmos/distribution/v1beta1/params`, not hardcoded. Below 10 SCRT delegated to a
validator, `MsgSetAutoRestake` is pointless for that validator and the UI must say so instead of
offering a toggle that silently does nothing.

secretjs exposes both figures directly — `distribution.restakeThreshold({})` returns
`{"threshold":"10000000.000000000000000000"}` and `distribution.restakingEntries({ delegator })`
returns the validator addresses a delegator has it switched on for. Both are Secret's own
additions to `x/distribution`; neither exists on a stock Cosmos chain.

## Staking shape

|                                |                        |
| ------------------------------ | ---------------------- |
| Bonded (active) validators     | **26**                 |
| Validators across all statuses | 236                    |
| `max_validators`               | 80                     |
| Unbonding period               | 1814400s = **21 days** |

The active set is far smaller than the cap, so a validator list built from
`BOND_STATUS_BONDED` shows 26 of 236. That is right for choosing who to stake with, and wrong for
showing what you already have: **a delegation outlives its validator's place in the active set**.
A stake with one that gets jailed or unbonded would vanish from a bonded-only list while still
existing on chain — and it is exactly the delegation someone most needs to find and move. So any
validator the account delegates to is fetched individually and added to the list.

Rewards and the restake threshold both arrive as 18-place decimal strings (`123.456…` uscrt) and
are truncated, never rounded. Rounding a reward up shows a figure that cannot be claimed.

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

**"Settled in phase 6" turned out to be wrong, and here is the correction.** The malformed-query
trick (`Error parsing into type crosschain_swaps::msg::QueryMsg: unknown variant ..., expected
'recoverable'`) only proves the deployed contract's `QueryMsg` enum has one variant named
`recoverable` — which is true of every version of this contract, old and new, since that variant
was never renamed. It says nothing about `ExecuteMsg`, and the conclusion drawn from it — "this
deployment matches the current source" — did not hold. Read the actual deployed bytecode's own
state instead of trusting that inference:

```
$ curl .../cosmwasm/wasm/v1/contract/osmo1uwk8x…qxwvxs/state
contract_info  {"contract":"crates.io:crosschain-swaps","version":"0.1.0"}
config         {"governor":"osmo1tfu4j…","swap_contract":"osmo1fy547…"}   — no registry_contract
chain_mapakash    "channel-1"      chain_mapjuno     "channel-42"
chain_mapaxelar   "channel-208"    chain_mapstars    "channel-75"
chain_mapcosmos   "channel-0"      chain_mapstride   "channel-326"
chain_mapevmos    "channel-204"
```

**Version 0.1.0 predates Osmosis's March 2023 registry-contract migration**
(`osmosis-labs/osmosis` commit `1d76f4f39d`, "XCS + Registries integration"). It has no
`registry_contract` field at all — routing is these `chain_map<prefix>` entries, hand-populated by
governor-only management messages, one governance action per chain. **`secret` was never added.**
A bare `secret1…` receiver goes through `validate_simplified_receiver`
(`checks.rs` at the pre-migration commit `a9725d6`), decodes the bech32 prefix, and does
`CHANNEL_MAP.load(storage, "secret")` — which fails, because the key does not exist. The error is
`invalid receiver: secret1…`, and it is unconditional: no channel this app supplies, no memo
shape, nothing on our side changes it. This is not fixable by adjusting anything this dashboard
sends — only the contract's governor can add an entry, and no proposal to add Secret has been
found.

**What actually works, from the same source:** the contract accepts a second receiver format,
`ibc:channel-<n>/<addr>`, handled by `validate_explicit_receiver` — no map lookup, no prefix
check, the channel is used exactly as given. `execute.rs` confirms the string carries straight
through to the outbound `MsgTransfer`'s `source_channel`, and `next_memo` handling is unaffected
either way. So the receiver Get-gas sends is `ibc:channel-88/secret1…`, not a bare address —
`channel-88` being Osmosis's own verified channel to Secret, above.

Two things decide whether the gas leg works at all, both read out of the source that actually
runs, not the source that happens to share a repository with it:

1. **`next_memo` is the slot that reaches Secret, not `final_memo`.** Confirmed unchanged across
   both versions: the reply handler builds the outbound `MsgTransfer`'s memo from
   `forward_to.next_memo`, which is what `next_memo` in the request becomes. SCRT on Osmosis is
   `transfer/channel-88/uscrt`, so returning it to Secret is a one-hop unwind — there is only one
   transfer, and its memo is the one carried through. `final_memo` is not read by this version at
   all.
2. **The receiver must be the explicit `ibc:channel-88/secret1…` form**, for the reason above.

**Live-verified, 2026-09-06:** a real deposit sent the bare-address form and failed exactly this
way — `write_acknowledgement` on Osmosis carried `packet_ack: {"error":"ABCI code: 6…"}`, and the
`ibccallbackerror-ibc-acknowledgement-error` event read `invalid receiver: secret1…`. Standard
ICS-20 ack-failure semantics then refunded the gas slice back to the sender on the source chain —
nothing was lost, the feature simply never delivered. The wrap leg, sent as a separate packet in
the same broadcast, is unaffected by any of this and succeeded on its own; the two packets have
no relationship the chain enforces.

**Still open:** the contract merges its own `ibc_callback` key into the memo it forwards, to track
the send. How Secret's `x/ibc-hooks` treats a memo carrying both `ibc_callback` and `wasm` remains
unverified for `credits` delivery, which is why `native` stays the default — no `wasm` key on that
leg, nothing to misparse.

### Getting there: each source chain needs its own channel to Osmosis

The gas leg's `MsgTransfer` has to reach _Osmosis_, not Secret — its receiver is the
`osmo1…` swap contract above, and only Osmosis can credit that address. Depositing directly
from Osmosis needs no extra hop. Depositing from anywhere else does, and that hop travels
over a channel this chain has to Osmosis specifically — which is **not** the same channel
the main leg uses to reach Secret.

**Found the hard way:** a live deposit of 4 USDC from Noble with both Wrap and Get gas
checked wrapped correctly but delivered no gas. Before this was caught, the code sent the
gas leg over `chain.depositChannel` for every chain but Osmosis — Noble's ordinary route to
_Secret_. Secret cannot credit an `osmo1` receiver, so that packet failed while the
unrelated wrap packet, sent separately, succeeded on its own. Nothing in the UI or the
broadcast result said so: `sendDeposit` only reports whether the source chain accepted the
messages for relay, not what happened to either packet afterward.

Each source chain now needs a verified `osmosisChannel` before "Get gas" is offered from it
at all — see `SourceChain.osmosisChannel` in `chains/sources.ts`. Verified so far:

| Chain | Channel   | Checked                                                                                                |
| ----- | --------- | ------------------------------------------------------------------------------------------------------ |
| Noble | channel-1 | Noble's own LCD: `STATE_OPEN`, counterparty `channel-750`, `connection-2`'s client reports `osmosis-1` |

Every other chain is deliberately left unrouted rather than filled in from the chain-registry's
`preferred` flag alone — the registry has been wrong about which chain an entry actually serves
before (see Bridge channels, below), and a wrong channel here does not error, it just quietly
fails to deliver gas the same way this one did. Adding a chain means querying that chain's own
LCD the way Noble's was, not copying the registry number.

## Bridge channels

All **37** of Secret's outgoing transfer channels are `STATE_OPEN` and their light clients report
the chain the route table expects. Checked by `verify:chain`, because both halves rot silently and
a transfer into a closed channel does not bounce back on its own.

The route table itself keeps **215 deposit** and **214 withdraw** routes, and drops **156** that
went through Axelar's gateway.

## Axelar: two different things

Worth separating, because conflating them either blocks working routes or offers dead ones.

- **Axelar's chain** (`axelar-dojo-1`) is an ordinary Cosmos chain reachable over `channel-20`,
  which is **open** and points at Axelar. Bridging to and from it works, and it is offered.
- **Axelar's gateway service**, which wrapped Ethereum and other EVM assets into saUSDC, saWETH
  and the rest, is what was disabled after the exploit below. Those routes are not offered.

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

## Off-chain data sources

Probed the same way as the endpoints, and with the same result: one of them is gone.

| Source                                 | State                           | Used for     |
| -------------------------------------- | ------------------------------- | ------------ |
| `SecretFoundation/DappRegistry`        | ok, 25 apps                     | Ecosystem    |
| DefiLlama `/chains`                    | ok                              | value locked |
| CoinGecko `simple/price`               | ok                              | prices       |
| `dashboardstats.secretsaturn.net`      | **dead — DNS does not resolve** | —            |
| Lavender.Five `networks/secretnetwork` | ok, needs the trailing slash    | —            |

The reference dashboard draws five separate panels from `dashboardstats.secretsaturn.net`:
wallets, validator bonding, daily network stats, relayer stats and weekly contract usage. That
host no longer resolves, so all five are gone. Its `lcd.mainnet.secretsaturn.net` fails the same
way, which is what first suggested checking.

Nothing was rebuilt against another indexer. The Network page reads Secret's own modules instead:

| Figure                               | Source                                         |
| ------------------------------------ | ---------------------------------------------- |
| Bonded / total supply / staked ratio | `staking/pool` + `bank/supply/by_denom`        |
| Inflation                            | `mint/v1beta1/inflation`                       |
| Block height and time                | `base/tendermint/blocks/latest`                |
| Community pool                       | `distribution/community_pool`                  |
| Active validators                    | `staking/validators?status=BOND_STATUS_BONDED` |

Sampled 2026-09-06: 360,181,634 of 1,446,381,398 SCRT bonded (24.90%), inflation 5.00%, height
27,026,411, 26 active validators. Only price and value locked still come from outside, and both
show as unavailable rather than as zero when they cannot be fetched.

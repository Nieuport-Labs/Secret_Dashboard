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

## Osmosis leg (for "Get gas") — three live failures and a migration

This feature went through three rounds of "it should work" against a real packet, in order:

**Round 1 — the receiver.** Osmosis's `crosschain-swaps` contract
(`osmo1uwk8xc6q0s6t5qcpr6rht3sczu6du83xq8pwxjua0hfj5hzcnh3sqxwvxs`, quoted everywhere as
`CrossChainSwaps v1.2`) turned out, read from its own on-chain state rather than from the
label, to be `crates.io:crosschain-swaps` **version 0.1.0** — from before Osmosis's March 2023
registry-contract migration (`osmosis-labs/osmosis` commit `1d76f4f39d`). It has no
`registry_contract` field. Routing is a hand-populated `chain_map<prefix>` — `akash`, `axelar`,
`cosmos`, `evmos`, `juno`, `stars`, `stride`, one governor-only management message per chain.
**`secret` was never added.** A bare `secret1…` receiver decodes its bech32 prefix and does
`CHANNEL_MAP.load(storage, "secret")`, which fails: `invalid receiver: secret1…`, live-verified
2026-09-06 via Osmosis's `write_acknowledgement` event. The malformed-query trick that had
previously been read as "this deployment matches the current source" only ever proved the
`QueryMsg` enum has a variant named `recoverable` — true of every version, since that name was
never changed. Reading actual deployed state is what actually settles a version.

**Round 2 — routed around the map, same contract.** The contract's other receiver format,
`ibc:channel-<n>/<addr>`, skips `CHANNEL_MAP` entirely — confirmed in `execute.rs`, where the
parsed channel carries straight through to the outbound `MsgTransfer`'s `source_channel`. Sending
`ibc:channel-88/secret1…` cleared the receiver check. The **swap** then failed instead: `Invalid
Pool Route: "No route found for ibc/498A…(USDC via Noble) -> ibc/0954…(SCRT)"`. Querying the
underlying `swaprouter` contract's `get_route` directly confirmed why — it has exactly one
registered route ending in SCRT: `uosmo → SCRT` (pool 584). Not USDC, not ATOM (checked both).
Same governor, same one-pair-at-a-time management pattern as the receiver map. This is not a
message-shape problem; the liquidity path this contract knows simply does not include SCRT from
anything but OSMO itself.

**The migration.** Both limits live in contracts this app does not own and cannot patch around —
each additional asset needs its own governance action from someone else. Skip Go's routing API
replaced the whole mechanism: `POST /v2/fungible/route` draws on Osmosis's live poolmanager
(pool 2477 → pool 585 for USDC → SCRT, found and priced automatically, no hand-registered pair
required) rather than a static list, and `POST /v2/fungible/msgs` returns a single, fully-formed
`MsgTransfer` for the source chain — its memo already carries the swap instructions and the
onward IBC forward to Secret. This is what `lib/skipGo.ts` calls; the gas leg is planned there and
nowhere else now.

**Verified against the live API, 2026-09-06** — `POST /v2/fungible/route` with
`source_asset_denom: uusdc`, `source_asset_chain_id: noble-1`, `dest_asset_denom: uscrt`,
`dest_asset_chain_id: secret-4`, `amount_in: 130000` returned `does_swap: true`,
`chain_ids: [noble-1, osmosis-1, secret-4]`, and a two-hop `operations` list through Osmosis's
poolmanager. `POST /v2/fungible/msgs` with an `address_list` for those three chains returned one
`/ibc.applications.transfer.v1.MsgTransfer` on `noble-1`, `source_channel: channel-1`, receiver
`osmo10a3k4h…` — Skip's own entry-point contract, not the retired `crosschain-swaps` address —
carrying a `swap_and_action` memo whose `post_swap_action.ibc_transfer.ibc_info` names
`channel-88` and a bare `secret1…` receiver (Skip's contract does its own routing and does not
hit the old contract's map at all, so no `ibc:channel-88/` prefix is needed here). Confirmed a
second time directly from this app's own preview, via the page's own `fetch`, past the point
where an earlier attempt had been mistaken for a CORS failure — the request succeeds and returns
a live quote.

**What this ends, and what it does not.** `credits` delivery — landing a fee-vault allowance
instead of spendable SCRT — depended on attaching this app's own hook to the final Secret-side
memo. Skip decides that memo itself with no documented way to extend it, so `credits` has no
migration path and is retired along with the contract it depended on; `native` — already the
default, for an unrelated reason (see the retired `ibc_callback`/`wasm` note this replaces) — is
now the only path. Every source chain is reachable in principle, subject to Skip actually finding
a route for that chain's asset, checked live per request rather than read from a table this app
maintains — the per-chain `osmosisChannel` field and its `canRouteToOsmosis` gate are gone, since
a hand-maintained "does this chain work" list is the exact failure mode this migration is fixing.

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

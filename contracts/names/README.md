# secret-dashboard-names

A name registry where the name never resolves to an address.

Someone hands out `alice.scrt`. A stranger can read the public profile behind
it and send a tip to it. What the stranger cannot do — not through this
contract, not by reading the chain, and not by decrypting anything their own
wallet holds — is learn which account that name belongs to.

This is the private half of the pair. `contracts/profile` is the public half:
same fields, keyed by address, readable by anyone who has the address. The two
are separate contracts and separate records on purpose, and nothing links them.

## The rule everything here follows

The design people reach for first does not work, and the reason is easy to miss.

A registry that resolved the name inside the enclave and forwarded the tip in
the same transaction would emit `transfer { recipient: <alice> }` as an outgoing
message. Secret encrypts those — but with the **transaction sender's** key.
From `docs/protocol/encryption-specs.md`, the Output section:

```js
encrypted_msg = aes_128_siv_encrypt({
  key: tx_encryption_key,                            // the original sender's
  data: concat(m["callback_code_hash"], m["msg"]),
});
```

and the same document: "Only the wallet with the right `tx_sender_wallet_privkey`
can derive `tx_encryption_key`". In a forwarding design the tipper is that
wallet, so the tipper can decrypt the message and read the address. The
dashboard would not show it. A short script would.

Log attributes and the `data` field are encrypted the same way, to the same
person. So:

> No transaction signed by the tipper may contain, emit, or cause the
> recipient's address to be written into an output.

Which forces escrow. A name is not a pointer to an account; it is an account.
Tips accumulate under the name, and the owner takes them out in a transaction
they sign themselves — where the payout address is encrypted under their own key
and is theirs to know.

## Messages

```jsonc
// Claim a free name. The sender is irrelevant: a key owns the name, not an
// address, so this may be relayed by anyone.
{ "register": { "label": "alice", "owner_pubkey": "<base64, 33 bytes>" } }

// Everything an owner does. One envelope, one place where authorisation happens.
{ "authorise": {
    "label": "alice",
    "nonce": 0,
    "action": { "set_profile": { "name": "…", "bio": "…", "avatar": "…", "links": [] } },
    "signature": "<base64, 64 bytes>"
} }

// The other actions:
//   { "withdraw": { "token": "secret1…", "amount": null, "to": "secret1…" } }
//   { "transfer_name": { "new_owner_pubkey": "<base64>" } }
//   { "release": {} }

// SNIP-20 callback. A tip arrives from the token contract, never from the tipper.
{ "receive": { "sender": "…", "from": "…", "amount": "1000000",
               "msg": "<base64 of { \"tip\": { \"label\": \"alice\" } }>" } }
```

Queries:

```jsonc
{ "profile":   { "label": "alice" } }   // public: name, bio, avatar, links
{ "available": { "label": "alice" } }   // public: taken or not
{ "balance":   { "label": "alice", "token": "secret1…",
                 "nonce": 0, "signature": "<base64>" } }   // owner only
```

There is no `resolve`. There is no reverse index, no enumeration, and no
permission level at which any of those appear, because no address belonging to
an owner is stored in the first place. A name is a key in a map whose values
contain a public key, a counter, a profile and some balances — and nothing else.

A tip to a name nobody has registered is refused rather than absorbed, which
reverts the SNIP-20 send and returns the tokens.

## Labels

Lowercase ASCII letters, digits and hyphens; 3 to 32 characters; no leading or
trailing hyphen. Case is folded, so `Alice` registers `alice`. Everything else
is refused rather than rewritten.

ASCII-only is a security decision, not a simplification. In a name service that
allowed Unicode, `аlice` with a Cyrillic а renders identically to `alice` in
every font a person will ever read it in, and the whole premise is that someone
types what they were told and reaches who they meant. NFKC and the other
normalisation forms narrow that gap; refusing the characters closes it.

(The *display* name inside the profile is unrestricted Unicode and counted in
characters rather than bytes. It is not something anyone types to reach you, so
it has no lookalike problem to solve.)

## Ownership is a key

`owner_pubkey` is a 33-byte compressed secp256k1 point, and the address that
pays gas for a transaction proves nothing about who owns the name in it.

That matters because an address that signs is an address that can be watched.
Bind ownership to `info.sender` and the transaction registering a name and the
transaction withdrawing from it are the same account, and anyone reading the
chain can join them. A key detached from every account breaks that link and lets
an owner relay through whatever address is convenient.

**The key must not be a wallet account key.** A signature carries its public key,
a public key determines an address, and the payload rides in a transaction's
encrypted `msg` — which the *relayer* can decrypt, being its sender. Relaying a
signature made by your account key would hand the relayer your address and undo
the point. The intended client derives a dedicated key deterministically from an
ADR-036 `signArbitrary` signature over a fixed string, so it is recoverable on
any device from the wallet alone and corresponds to no account anyone uses. This
contract never learns which; it only ever sees an opaque point.

### What gets signed

```
digest = SHA256(
    "secret-dashboard-names/v1/action"
  ‖ u32be(len(chain_id))      ‖ chain_id
  ‖ u32be(len(contract_addr)) ‖ contract_addr
  ‖ u32be(len(label))         ‖ label
  ‖ u64be(nonce)
  ‖ u32be(len(action_json))   ‖ action_json
)
```

`action_json` is the `Action` serialised exactly as it appears in the message.
The balance query signs the same shape with the domain
`secret-dashboard-names/v1/balance` and the token address in place of
`action_json`.

Every variable part is length-prefixed, so no two different sets of fields can
hash to the same bytes. The chain id and the contract address are in there so a
signature cannot be lifted onto a testnet twin or a second deployment, and the
two domains keep a captured balance query from becoming authority to move money.

The signature is 64 bytes, `r ‖ s`, low-S. The nonce must equal the record's
current one and is spent whether the action succeeds or not — on chain a failing
action reverts the whole transaction, nonce included, so in practice a nonce is
spent exactly by a successful action.

## The token allowlist

Set at instantiate. There is no message that extends it and no CosmWasm admin.

Paying a name out calls `transfer { recipient }` on the token contract, and that
message is decrypted **inside the token's own execution**. A hostile SNIP-20
would therefore see the payout address in plaintext and could publish it through
a getter with no access control. A registry that accepted any token would be
handing a deanonymisation oracle to anyone willing to deploy one.

Two things follow, and neither is papered over:

- Adding a token later means a new instance, and names do not move between
  instances. Choose the list generously at instantiate.
- **Allowlisted is not trusted forever.** sSCRT is code `2280` and has a
  CosmWasm admin, so whoever holds that key can migrate it. That is what the
  `to` field on `withdraw` is for: send to an address you will never use again
  and a token that turns hostile learns a burner, not an identity.

## The delayed write buffer

Contract storage is encrypted, but an adversarial node operator can still see
*which* encrypted keys a transaction touches. Credit a name directly and the tip
writes that name's balance key; the withdrawal later reads the same key; joining
the two links the tipper to the address that claimed. Everything else here could
be perfect and the privacy would still be gone.

So a credit goes into one of 64 slots chosen from `env.block.random`, and pays
for its slot by settling whichever unrelated credit was sitting there. Every tip
writes exactly one balance key belonging to somebody else, picked without
reference to its own recipient; the name it was actually for is written at some
unpredictable later moment, by a transaction with no connection to the tipper.

The idea and the sizing come from SNIP-20's delayed write buffer, which scrtlabs
shipped across 42 mainnet tokens for exactly this reason (`dwb.rs` in
[scrtlabs/snip20-reference-impl](https://github.com/scrtlabs/snip20-reference-impl),
Apache-2.0; analysis in [arXiv 2607.04032](https://arxiv.org/abs/2607.04032),
which measures roughly +26% gas and reports that at k=64 an attacker needs close
to 300 further transactions for 99% confidence that a given balance was
touched). `src/dwb.rs` is a much smaller thing than theirs — credits only, no
transfer graph, no bucketed trie — because nobody spends from a name but its
owner.

## What still leaks

A design like this is worth exactly what its honest list says.

1. **Gas classifies the operation.** Registering, tipping, editing a profile and
   withdrawing are all `MsgExecuteContract` against this contract with an
   encrypted message, but they cost visibly different amounts. Padding fixes
   ciphertext length, not gas. Not fixable in a contract.
2. **Registration timing.** Poll `available` every block, learn which block a
   name was taken in, and intersect with the addresses that touched this
   contract in that block. Relaying registration from an address unrelated to
   the payout address is the mitigation, and it is the client's job.
3. **Amount correlation.** One tip of 12.34 followed by one withdrawal of 12.34
   links them whatever the storage layer does. Accumulate, and withdraw partial
   amounts.
4. **Native SCRT is not accepted and could not be made private.** A contract's
   `BankMsg::Send` is an ordinary bank transfer with a public recipient and
   amount. Wrap first.
5. **Do not reuse an avatar across the two registries.** Publishing the same
   64px WebP here and in `contracts/profile` — which is keyed by address — links
   the name to the address by byte comparison, instantly and permanently.
   Neither contract can detect it; the client has to.
6. **Names are free, first-come, and never expire.** There is no fee, no auction
   and no renewal, so nothing here stops one script from taking every good name.
   That is an unsolved economic question, not an oversight, and it should be
   answered before this is opened to the public rather than after.

Nothing here has been audited.

## Build

Needs the Rust wasm target and Docker for the reproducible optimiser.

```bash
rustup target add wasm32-unknown-unknown
cargo test
cargo build --release --target wasm32-unknown-unknown
```

`.cargo/config.toml` passes `--import-undefined` to the linker, and the build
fails without it on any recent toolchain — the enclave's host functions
(`addr_validate`, `secp256k1_verify`, …) are undefined at link time by design,
and `secret-cosmwasm-std` 1.1.11 predates the change that made `wasm-ld` treat
that as an error. The `random` feature on that crate is what exposes
`env.block.random`, which the buffer draws its slot from.

```bash
docker run --rm -v "$(pwd)":/contract \
  --mount type=volume,source="$(basename "$(pwd)")_cache",target=/code/target \
  --mount type=volume,source=registry_cache,target=/usr/local/cargo/registry \
  ghcr.io/scrtlabs/secret-contract-optimizer:1.0.13
```

That writes `optimized-wasm/secret_dashboard_names.wasm.gz` — 87kB against the
279kB `cargo build` produces. Upload that one: the optimiser is what makes the
bytecode reproducible, and a reproducible build is the only way anyone can later
check that what is deployed matches this source.

## Deploy

**Not possible today.** Secret mainnet has `MsgStoreCode` and
`MsgInstantiateContract` disabled chain-wide by the circuit breaker governance
proposal 370 installed on 2026-09-04. Check before trying:

```bash
curl -s https://lcd-secret.keplr.app/cosmos/circuit/v1/disable_list
```

An empty `disabled_list` means the freeze has lifted. Until then an upload fails
with `tx type not allowed` and `gas_used: "0"` — a CheckTx rejection that costs
nothing and is not a key, node or gas problem.

When it lifts:

```bash
secretcli tx compute store optimized-wasm/secret_dashboard_names.wasm.gz \
  --from <key> --chain-id secret-4 --gas 4000000 -y
```

```bash
secretcli tx compute instantiate <code-id> \
  '{"tokens":[{"address":"secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek","code_hash":"<from chain>"}]}' \
  --from <key> --chain-id secret-4 --label secret-dashboard-names-v1 --gas 400000 -y
```

Read each code hash from the chain rather than from a published list:

```bash
secretcli query compute contract-hash <token-address>
```

No admin is set, deliberately. There is no privileged action in this contract,
and a key able to migrate the code could point every future withdrawal at a
contract of its own choosing — which is the one power that would undo everything
above.

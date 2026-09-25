# Profile registry

One public profile per account: display name, bio, a small avatar and a handful
of social links. Written by the account it belongs to, readable by anyone who
knows the address.

The dashboard talks to this through [`src/lib/profile.ts`](../../src/lib/profile.ts),
and finds it at `PROFILE_REGISTRY_ADDRESS` in
[`src/chains/secret4.ts`](../../src/chains/secret4.ts).

## What is and is not private

Everything in a profile is public. The `Profile` query takes no permit and no
viewing key, because the point of a profile is that somebody handed a link can
see whose it is.

Secret's encrypted state is still doing something here — a node operator cannot
read the bucket, and nobody can enumerate it, so there is no way to obtain a
list of every account that has ever saved a profile. You can only ask about an
address you already have. That is the difference between a profile and a
directory.

Two things leak regardless, and are worth stating plainly because no contract
can hide them:

- **That you wrote.** The transaction is public: address X executed this
  contract at time T. The contents are encrypted, the fact of it is not.
- **What you chose to publish.** Linking an X handle to a Secret address ties
  the two together for good. That is the feature, but it is irreversible in
  practice — the chain keeps the history even after a `Clear`.

## Messages

```jsonc
// execute — the sender is always the owner; there is no `owner` argument
{ "set": {
    "name":   "Alice",
    "bio":    "",
    "avatar": "data:image/webp;base64,UklGR…",  // or ""
    "links":  [{ "kind": "x", "value": "alice" }]
} }
{ "clear": {} }

// query — permissionless
{ "profile":  { "address": "secret1…" } }
{ "profiles": { "addresses": ["secret1…", "secret1…"] } }
```

`profile` answers `{ "profile": null }` for an account that has never saved one,
and `profiles` keeps those nulls in place rather than dropping the rows, so the
caller can line the answers up against what it asked for.

Limits, enforced in the contract rather than only in the form: name 32
characters, bio 280, 8 links of 16/200 characters, avatar 12 kB of base64 and it
must start with `data:image/webp;base64,`.

## Build

Needs the Rust wasm target and Docker for the reproducible optimiser.

```bash
rustup target add wasm32-unknown-unknown
cargo test
cargo build --release --target wasm32-unknown-unknown
```

`.cargo/config.toml` passes `--import-undefined` to the linker, and the build
fails without it on any recent toolchain. The host functions a Secret contract
calls — `addr_validate`, `secp256k1_verify` and the rest — are provided by the
enclave at run time, so they are undefined at link time by design. Rust used to
import such symbols silently; since 1.82 `wasm-ld` treats them as errors unless
told otherwise, and `secret-cosmwasm-std` 1.1.11 predates that change. Checked
against rustc 1.96.

```bash
docker run --rm -v "$(pwd)":/contract \
  --mount type=volume,source="$(basename "$(pwd)")_cache",target=/code/target \
  --mount type=volume,source=registry_cache,target=/usr/local/cargo/registry \
  ghcr.io/scrtlabs/secret-contract-optimizer:1.0.13
```

That writes `optimized-wasm/secret_dashboard_profile.wasm.gz` — 63kB against
the 200kB `cargo build` produces. Upload that one, not the plain `cargo`
artifact: the optimiser is what makes the bytecode reproducible, and a
reproducible build is the only thing by which anyone can later check that what
is deployed matches this source.

## Deploy

```bash
secretcli tx compute store optimized-wasm/secret_dashboard_profile.wasm.gz   --from <key> --chain-id secret-4 --gas 4000000 -y
secretcli tx compute instantiate <code-id> '{}'   --from <key> --chain-id secret-4 --label secret-dashboard-profile-v1 --gas 300000 -y
```

No admin is set on purpose. The contract has no privileged action, so an admin
key would only be able to migrate the code under everyone's profiles — a power
with no matching use and a real cost if the key ever leaks.

Then put the resulting address in `PROFILE_REGISTRY_ADDRESS`. Until that
constant is filled in, the dashboard shows the profile editor read-only and says
the registry is not deployed yet, rather than failing at signing time.

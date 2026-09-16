# Dependency advisories

What `npm audit` reports, why it reports it, and what was decided. Written down
because an advisory with no note attached gets re-investigated from scratch
every few months, and because `package.json` cannot hold a comment next to the
`overrides` block that answers it.

Last checked: 2026-09-16.

## `uuid` — overridden to ^11.1.1

[GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq):
a missing buffer bounds check in `v3`, `v5` and `v6` **when a `buf` argument is
passed**. Reported five times over, once for each package in the chain:
`uuid` → `@waku/core` → `@waku/discovery` / `@waku/message-encryption` →
`@waku/sdk`.

Not reachable here. Waku's only use of it is a request id on its light push,
filter and store RPCs, and every call site is `v4()` with no arguments — a
search of the whole tree finds no `v3`, `v5` or `v6` anywhere.

Overridden anyway, because the override is free: the newer major is a drop-in
for `v4()`, and it removes five lines of noise that would otherwise have to be
re-read and re-dismissed by whoever runs `npm audit` next. Checked against the
live network afterwards, since request ids are what every Waku RPC is keyed by:
a node connects, a message publishes, the filter subscription receives it, and
a store query returns it.

If a future `@waku/core` needs the older major back, drop the override — the
advisory never applied to this app.

## `elliptic` — left alone, deliberately

[CVE-2025-14505](https://github.com/advisories/GHSA-848j-6mx2-7j84): the
byte-length of the ECDSA nonce `k` is computed wrongly, so it can be truncated.
The consequences are broken signatures and — given both a faulty and a correct
signature over identical input — the possibility of deriving the private key.
CVSS 2.9. Reported seven times over, once for each package between `elliptic`
and `secretjs`, including `tiny-secp256k1` and `bip32`.

**There is no patched version.** Every release is affected, 6.6.1 included, and
that is already what the `overrides` block pins.

It is a flaw in signature _generation_, and this app generates no signatures:
it never holds a private key. Signing happens inside Keplr or StarShell, in
their own process, with their own crypto. The only `@cosmjs/crypto` calls in
`src/` are two `Secp256k1.verifySignature` in the multisig code
(`lib/multisig/flow.ts`, `lib/multisig/verify.ts`), and verification has no
nonce to get wrong. No software wallet is ever built from a mnemonic here.

`npm audit fix --force` proposes `@cosmjs/crypto@0.39.0`. That would not help:
`secretjs` pins its own `@cosmjs/*`, so `elliptic` stays in the tree either
way, and a second copy of cosmjs is exactly what this project avoided when it
declared the 0.32 line to match secretjs's own. A breaking change for no
security gain.

Worth revisiting if `elliptic` ever ships a fix, or if the app ever grows a
reason to sign something itself — at which point this stops being theoretical.

# Multisig

An account several keys control together, and the screens for using one.

It is the Cosmos SDK's own multisig — `tendermint/PubKeyMultisigThreshold`, the
kind `secretcli keys add --multisig` produces — not a contract. Two reasons,
and either would be enough. Contracts cannot be deployed on `secret-4` at all
right now: `MsgStoreCode` and `MsgInstantiateContract` are disabled chain-wide
by the circuit breaker (governance proposal 370, still in force). And a key
multisig costs nothing to create, has no code to trust or upgrade, and is
understood by `secretcli`, which is both an independent check on this app and
a way out if it ever goes away.

The account is a hash of its members' public keys and its threshold. There is
no state anywhere — on chain or off — that cannot be re-derived from those,
which is why creating one is free and why losing this app costs a group
nothing but convenience.

## The problem this solves that other multisig tools do not

On Secret the body of a contract call is encrypted. A member asked to approve
one would otherwise see this, in the app and in their wallet alike:

    wasm/MsgExecuteContract   msg: "3q2+78r+…"    (400 bytes of base64)

Nobody can tell a token transfer from "send everything to me" by looking at
that, so "the proposer says it is a transfer" would be the entire security
model.

So **every proposal carries its own freshly generated transaction-encryption
seed**. The proposer encrypts with it, the seed travels inside the proposal,
and each member's own machine decrypts the ciphertext and checks that what
comes out is the message the proposal claims, encrypted to the contract code
the proposal claims. A proposal that fails that cannot be signed here — not
"is discouraged": the transaction cannot be built at all, so there is nothing
for a wallet to sign.

The same seed decrypts the contract's reply after broadcast, so every member
can read what happened rather than only whoever pressed the button.

**What it costs.** Whoever holds a proposal can read its messages before they
are sent. Every member can read them anyway — that is the point of reviewing
one — so what is given up is confidentiality against someone who intercepts a
proposal in transit, and what is bought is that no member has to sign
something they cannot read. Do not post a proposal somewhere public.

The seed is **not** a signing key. It grants no authority over the account.

## What is checked, and where

Nothing is trusted because of where it came from. A proposal that arrives by
clipboard, file or QR code is checked identically, and a tampered one cannot be
signed at all — the button has nothing to sign, because the transaction could
not be built.

The checks themselves are not paraded. A clean review is one line above the
Sign button and anything that failed is a card that cannot be scrolled past;
the itemised list is behind "What was checked". A wall of green ticks on every
proposal is what teaches people to skip the one that is not green.

Before a member can sign:

| Check                   | What it rules out                                                          |
| ----------------------- | -------------------------------------------------------------------------- |
| Account and fingerprint | A proposal for a different account or a different member set               |
| Signers                 | A message that acts for somebody else, which the chain would refuse anyway |
| Ciphertext              | A proposal that shows one message and carries another                      |
| Code hash               | A message encrypted to code the named contract does not run                |
| Rebuild                 | Bytes taken on trust — the transaction is built locally or not at all      |
| Account number          | A proposal built against a different account's record                      |
| Sequence                | Signatures for a sequence the account has already spent                    |
| Fee                     | A granter with no grant, or an account that cannot pay                     |

After the wallet returns a signature, two more: the document the wallet says it
signed must be the one it was handed — a wallet that quietly adjusts the fee
produces a signature for a transaction nobody reviewed — and the signature must
verify locally before it is kept.

Every collected signature is verified against the locally rebuilt document
before it is counted, and one member signing twice counts once.

## Using it

1. **Create the account.** Add each member by pasting their public key, or their
   address — the chain is asked for the key it recorded the first time that
   account signed anything. An account that has never signed has no key on
   chain and must send it another way.

2. **Check the address before funding it.** This is the one mistake that cannot
   be undone: a wrong key produces a valid address nobody holds the keys to.
   Every member should see the same fingerprint, and at least one should run
   the `secretcli` command the create screen prints.

3. **Fund it.** Until something arrives the chain has no record of the account,
   so it has no account number and nothing it signs can be broadcast.

4. **Propose.** Any member picks what the group should do — send, wrap, stake,
   vote, set a viewing key, pay someone's fees — and fills in a short form.
   Staking, unstaking and moving a delegation open the staking screen's own
   dialog rather than a form of their own, so the group picks a validator the
   same way anybody picks one. Nothing is sent. Under Advanced the messages can
   still be written as JSON, which is the only route to a contract this app has
   no form for.

5. **Circulate it.** The channel does this by itself when it is up; otherwise
   copy, download or scan the proposal across. Whoever receives one brings it
   in with **Import** on the Proposals screen, which takes either form — the
   line the clipboard carries or the JSON in a file.

6. **Sign.** Each member reads what it does — "Send 10 SCRT to secret1abc…",
   with the exact message one click away — and signs. Then sends their
   signature back the same way. An open proposal the connected member has not
   signed puts a dot on the Proposals tab, so a round in progress does not
   depend on somebody remembering to look.

   A message this app cannot describe says so and shows its JSON instead. That
   is a refusal to guess rather than a failure to render: a confident summary
   of a message nobody parsed would be worse than no summary at all.

7. **Broadcast.** Whoever holds a threshold of verified signatures sends it.
   Anyone can — a signature is not a secret — but only verified ones are used.

## Viewing balances

A multisig **cannot use a query permit**. SNIP-24 verifies a permit by
recovering one secp256k1 public key and comparing its address; a multisig
signature is an aggregate with no such key behind it, so no permit a group can
produce will ever be accepted.

Private balances therefore need a **viewing key**, set by a transaction the
group signs together. The key is generated in the proposal, which means every
member learns it by decrypting the proposal they were already checking — no
second secure channel is needed.

Three things follow, and none are fixable by better software:

- it is a **shared secret**: anyone holding it can read the balance, member or
  not;
- it **outlives membership**: removing someone does not take their copy away,
  so a member leaving means setting a new key — another transaction;
- it is **per contract**: reading a new token means another transaction.

Native SCRT and IBC vouchers need none of this. They are public, and the
overview reads them for any account.

## Limits worth knowing before relying on it

- **Gas is chosen by hand.** secretjs refuses to simulate `MsgExecuteContract`,
  so a contract call cannot be sized by asking the chain. An under-gassed
  transaction costs the fee _and_ the whole round of signatures, because the
  sequence is spent either way. Err upwards.
- **A Ledger member signs blind.** The device shows the encrypted blob. The
  checks are real but they are this app's, not the hardware's.
- **Signatures are bound to a sequence.** Two proposals built on the same
  sequence are mutually exclusive: broadcasting one voids the other's
  signatures for good.
- **The channel is best-effort.** Waku keeps a message for about two days and
  nobody is obliged to relay it. Every copy re-publishes what it still holds,
  so a group stays in sync as long as one member is around — but the clipboard
  is always there, and a proposal that must arrive should be sent by hand.

## How proposals reach the other members

Over [Waku](https://waku.org), a peer-to-peer messaging network. A light node
in the browser hands a message to a service node, which relays it to everyone
subscribed to the same topic. Nobody operates the group's channel: there is no
account to suspend, no endpoint to block and no operator to ask — which is why
it was chosen over a small server, which would have been less code and one more
party able to stop a group working.

The topic and the payload key both come from the random secret in the account's
configuration, the one members exchange when they set the account up. That is
deliberate: a topic derived from the _address_ would be computable by anyone who
knows the account, and an observer could then watch the group's traffic and its
timing even without reading a word of it. Derived from a secret only members
hold, the conversation cannot be found at all.

Whether it is up shows in the footer, beside the attribution: "Connected to
Waku · 2 peers", or a line saying to pass proposals across by hand. It is
chrome rather than a panel because it is true of the whole app and its answer
is almost always the same one.

**It is not part of the security model.** Anyone who learns a topic can publish
to it, so bytes arriving that way go through exactly the parser and the checks a
pasted bundle does. What the channel buys is that members need not be online at
the same moment, and that nobody has to paste anything; what it costs, if it is
down, is that they do.

Practical limits, all of them the network's rather than this app's: 150 KB a
message, about one message a second, and roughly 48 hours of history. The
libp2p stack is around 800 KB and is fetched only when a multisig is actually
opened — a wallet screen never downloads it.

## Checking this app against `secretcli`

Address derivation is the part worth checking independently, and it is cheap:

```bash
secretcli keys add member1 --pubkey '{"@type":"/cosmos.crypto.secp256k1.PubKey","key":"<base64>"}'
secretcli keys add member2 --pubkey '{"@type":"/cosmos.crypto.secp256k1.PubKey","key":"<base64>"}'
secretcli keys add group --multisig member1,member2 --multisig-threshold 2
```

It should print exactly the address the create screen shows.

`npm run test:multisig` re-proves the same agreement on every run, against
vectors produced by `secretcli 1.25.0` — including a 2-of-3 transaction
combined by `secretcli tx multisign` that this app's assembler reproduces byte
for byte. The second half of that script needs the chain: it encrypts a real
message against sSCRT and checks that a member can tell what it says, and that
a wrong message, a wrong code hash and a decoy seed are each refused.

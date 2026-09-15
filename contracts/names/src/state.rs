use cosmwasm_std::{Addr, Binary, Storage, Uint128};
use cosmwasm_storage::{
    bucket, bucket_read, singleton, singleton_read, Bucket, ReadonlyBucket, ReadonlySingleton,
    Singleton,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// A name is an account, not a pointer to one.
///
/// Nothing in this module stores an address belonging to a name's owner, and no
/// query returns one, because the address is the thing the whole contract
/// exists to withhold. Funds sent to a name sit here under the name until the
/// owner asks for them, and the only transaction that ever names a payout
/// address is one the owner signed themselves — where it is encrypted under
/// their own key and is theirs to know.
///
/// The reason it has to work that way is in `contract.rs` above
/// `execute_withdraw`: a contract's outgoing messages are encrypted with the
/// *transaction sender's* key, so a registry that forwarded a tip in the
/// tipper's transaction would be handing the tipper the recipient's address.
pub const KEY_CONFIG: &[u8] = b"config";
pub const KEY_BUFFER: &[u8] = b"dwb";
pub const PREFIX_NAMES: &[u8] = b"names";
pub const PREFIX_BALANCES: &[u8] = b"balances";

/// A SNIP-20 this registry will accept and pay out.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct TokenRef {
    pub address: Addr,
    /// Read from the chain by whoever instantiates this, never hardcoded from a
    /// published list — see `src/lib/codeHash.ts` for why the app does the same.
    pub code_hash: String,
}

/// Set once at instantiate and never changed.
///
/// The allowlist is the load-bearing part. Paying a name out calls
/// `transfer { recipient }` on the token, and that message is decrypted inside
/// *the token contract's* own execution — so a hostile SNIP-20 would see the
/// payout address in plaintext and could publish it through a getter with no
/// access control. A registry that accepted any token would be a
/// deanonymisation oracle for anyone willing to deploy one.
///
/// There is no message that extends this list and no admin, which means adding
/// a token later costs a new instance. That is the price of not having a key
/// that can point everybody's withdrawals at a contract of its choosing.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct Config {
    pub tokens: Vec<TokenRef>,
}

impl Config {
    /// Index of a token in the allowlist. The index, not the address, is what
    /// balances are keyed by — it is one byte instead of forty-five, and the
    /// list it indexes into cannot change under it.
    pub fn index_of(&self, address: &str) -> Option<u8> {
        self.tokens
            .iter()
            .position(|token| token.address.as_str() == address)
            .map(|index| index as u8)
    }
}

/// One registered name.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct NameRecord {
    /// A compressed secp256k1 public key, 33 bytes.
    ///
    /// Ownership is a key rather than an address on purpose. An address that
    /// signs is an address that can be watched: the transaction paying gas to
    /// register a name and the one paying gas to withdraw from it would be the
    /// same account, and the two could be joined by anyone reading the chain.
    /// A key detached from every account breaks that, and lets the owner relay
    /// through whatever address is convenient.
    ///
    /// Never returned by any query, at any level. It is not secret — a
    /// signature reveals it — but handing it out on request would turn this
    /// into the reverse index the design refuses to have.
    pub owner_pubkey: Binary,
    /// Bumped by every authorised write. What stops a captured signature from
    /// being replayed.
    pub nonce: u64,
    pub profile: Profile,
    pub created_at: u64,
}

/// The public half: what a visitor handed `alice.scrt` gets to see.
///
/// Deliberately the same shape as `contracts/profile`'s, copied rather than
/// shared. The two contracts have separate deployment lifecycles and one of
/// them is already merged; coupling them through a workspace dependency to save
/// eighty lines would mean neither could be changed alone.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, JsonSchema)]
pub struct Profile {
    pub name: String,
    pub bio: String,
    /// A 64px square WebP as a `data:image/webp;base64,…` URI, or empty.
    pub avatar: String,
    pub links: Vec<Link>,
    /// Block time of the last write, in seconds.
    pub updated_at: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct Link {
    pub kind: String,
    pub value: String,
}

/// One buffered credit. An empty `label` means the slot is free.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, JsonSchema)]
pub struct Slot {
    pub label: String,
    pub token: u8,
    pub amount: Uint128,
}

impl Slot {
    pub fn is_free(&self) -> bool {
        self.label.is_empty()
    }
}

/// Balances are keyed by name and token index together.
///
/// `0xff` as the separator because a label is `[a-z0-9-]` by the time it gets
/// here, so the byte cannot occur inside one and the two halves can never be
/// confused for a different pair.
pub fn balance_key(label: &str, token: u8) -> Vec<u8> {
    let mut key = Vec::with_capacity(label.len() + 2);
    key.extend_from_slice(label.as_bytes());
    key.push(0xff);
    key.push(token);
    key
}

pub fn config(storage: &mut dyn Storage) -> Singleton<'_, Config> {
    singleton(storage, KEY_CONFIG)
}

pub fn config_read(storage: &dyn Storage) -> ReadonlySingleton<'_, Config> {
    singleton_read(storage, KEY_CONFIG)
}

pub fn names(storage: &mut dyn Storage) -> Bucket<'_, NameRecord> {
    bucket(storage, PREFIX_NAMES)
}

pub fn names_read(storage: &dyn Storage) -> ReadonlyBucket<'_, NameRecord> {
    bucket_read(storage, PREFIX_NAMES)
}

pub fn balances(storage: &mut dyn Storage) -> Bucket<'_, Uint128> {
    bucket(storage, PREFIX_BALANCES)
}

pub fn balances_read(storage: &dyn Storage) -> ReadonlyBucket<'_, Uint128> {
    bucket_read(storage, PREFIX_BALANCES)
}

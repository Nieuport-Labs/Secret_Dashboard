use cosmwasm_std::Storage;
use cosmwasm_storage::{bucket, bucket_read, Bucket, ReadonlyBucket};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Everything under one prefix, keyed by the owner's address.
///
/// A bucket rather than a keyed map with an index: there is deliberately no way
/// to list profiles. Knowing an address is what lets you read the profile that
/// belongs to it, and an enumerable registry would turn a dashboard feature
/// into a directory of everyone who has ever used it.
pub const PREFIX_PROFILES: &[u8] = b"profiles";

/// One account's public profile.
///
/// Public in the sense that matters here: any query returns it to anyone who
/// asks for that address, with no permit and no viewing key. The contract's
/// state is still encrypted at rest like every other Secret contract — that
/// protects it from the node operator, not from the caller.
///
/// Absent fields are empty strings rather than `Option`, because "cleared the
/// bio" and "never set a bio" are the same thing to every reader of this.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, JsonSchema)]
pub struct Profile {
    pub name: String,
    pub bio: String,
    /// A 64px square WebP as a `data:image/webp;base64,…` URI, or empty.
    ///
    /// The image itself, not a link to one. A URL would be cheaper, but it
    /// makes the profile depend on somebody else's hosting staying up and
    /// turns every visitor's page load into a request that hands their IP to
    /// whoever the owner pointed at.
    pub avatar: String,
    pub links: Vec<Link>,
    /// Block time of the last write, in seconds. What the client compares when
    /// deciding whether the copy on this device is older than the chain's.
    pub updated_at: u64,
}

/// One social link. `kind` is free-form on purpose — the contract has no
/// opinion about which services exist, and a fixed enum here would need an
/// upgrade every time the client learns a new one.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct Link {
    pub kind: String,
    pub value: String,
}

pub fn profiles(storage: &mut dyn Storage) -> Bucket<'_, Profile> {
    bucket(storage, PREFIX_PROFILES)
}

pub fn profiles_read(storage: &dyn Storage) -> ReadonlyBucket<'_, Profile> {
    bucket_read(storage, PREFIX_PROFILES)
}

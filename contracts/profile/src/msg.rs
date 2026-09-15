use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::state::{Link, Profile};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct InstantiateMsg {}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ExecuteMsg {
    /// Write the sender's whole profile, replacing whatever was there.
    ///
    /// Whole-record rather than per-field, because a profile is edited in one
    /// form and saved with one button: a field-at-a-time API would turn that
    /// one save into five transactions and five wallet prompts.
    Set {
        name: String,
        bio: String,
        avatar: String,
        links: Vec<Link>,
    },
    /// Remove the sender's profile entirely.
    Clear {},
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum QueryMsg {
    /// One profile. `None` when that account has never saved one.
    Profile { address: String },
    /// Several at once, for a list of accounts on one screen. Addresses that
    /// have no profile come back with `profile: null` rather than being
    /// dropped, so the caller can line the answers up with what it asked.
    Profiles { addresses: Vec<String> },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct ProfileResponse {
    pub profile: Option<Profile>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct ProfileEntry {
    pub address: String,
    pub profile: Option<Profile>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct ProfilesResponse {
    pub profiles: Vec<ProfileEntry>,
}

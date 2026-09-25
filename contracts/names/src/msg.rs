use cosmwasm_std::{Binary, Uint128};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::state::{Link, Profile};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct TokenInit {
    pub address: String,
    pub code_hash: String,
}

/// The allowlist is the whole configuration, and it is final. See
/// `state::Config` for why there is no message to extend it.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct InstantiateMsg {
    pub tokens: Vec<TokenInit>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ExecuteMsg {
    /// Claim a free name. Whoever sends this chooses the key that will own it,
    /// which need not be related to the address sending it — that is the
    /// point, and it is why registration takes a public key rather than
    /// trusting `info.sender`.
    Register { label: String, owner_pubkey: Binary },

    /// Do something to a name you hold the key for.
    ///
    /// One message for every owner action rather than one message each,
    /// because the signature has to cover the action anyway and a single
    /// envelope means there is exactly one place where authorisation happens.
    Authorise {
        label: String,
        nonce: u64,
        action: Action,
        signature: Binary,
    },

    /// SNIP-20 callback. A tip arrives here from the token contract, not from
    /// the person sending it.
    Receive {
        sender: String,
        from: String,
        amount: Uint128,
        msg: Option<Binary>,
    },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Action {
    /// Replace the public half of the record.
    SetProfile {
        name: String,
        bio: String,
        avatar: String,
        links: Vec<Link>,
    },
    /// Pay out. `to` is free-form on purpose: an owner who suspects a token
    /// may not stay honest can send to an address they will never use again,
    /// and the token learns a burner rather than an identity.
    Withdraw {
        token: String,
        /// `None` means everything this name holds of that token.
        amount: Option<Uint128>,
        to: String,
    },
    /// Hand the name to another key. A name that can change hands is what
    /// makes this a registry rather than a setting.
    TransferName { new_owner_pubkey: Binary },
    /// Give the name up. Refused while anything is still owed to it, since
    /// releasing would put those funds beyond everyone's reach including the
    /// next owner's.
    Release {},
}

/// What rides in the `msg` field of a SNIP-20 `Send`.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ReceiveMsg {
    Tip { label: String },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum QueryMsg {
    /// The public half. No permit and no key: a name exists so that someone
    /// handed one can see whose it is.
    Profile { label: String },
    /// Whether a name can still be taken. Every name system leaks this —
    /// there is no way to let people register without it.
    Available { label: String },
    /// What a name is holding. Signed by the owner's key, because the amount
    /// waiting for someone is theirs to know and nobody else's.
    ///
    /// A query cannot bump a nonce, so the signature here is over the *current*
    /// one and stops being valid as soon as the owner signs any execute. A
    /// captured balance query can therefore be replayed against a name whose
    /// owner has since done nothing else — it reveals a balance, never an
    /// address, and any authorised write closes it.
    Balance {
        label: String,
        token: String,
        nonce: u64,
        signature: Binary,
    },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct ProfileResponse {
    pub profile: Option<Profile>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct AvailableResponse {
    pub available: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct BalanceResponse {
    pub amount: Uint128,
}

/// The only SNIP-20 message this contract sends.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Snip20ExecuteMsg {
    Transfer {
        recipient: String,
        amount: Uint128,
        /// Brings every outgoing transfer to the same serialised length.
        /// Ciphertext length is not hidden by encryption, and an amount is
        /// between one and twenty digits.
        padding: String,
    },
}

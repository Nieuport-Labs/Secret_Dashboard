use cosmwasm_std::StdError;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum ContractError {
    #[error("{0}")]
    Std(#[from] StdError),

    #[error("{field} is longer than {max} characters")]
    TooLong { field: &'static str, max: usize },

    #[error("a profile may carry at most {max} links")]
    TooManyLinks { max: usize },

    #[error("the avatar must be a data:image/webp;base64 URI")]
    AvatarNotWebp,

    #[error("the avatar is larger than {max} bytes")]
    AvatarTooLarge { max: usize },

    #[error("a name {reason}")]
    BadLabel { reason: &'static str },

    #[error("that name is already registered")]
    LabelTaken,

    #[error("no such name")]
    NoSuchLabel,

    /// Deliberately the same message as an unregistered token would give on
    /// any other path: which tokens this registry accepts is public anyway
    /// (it is in the instantiate message), so there is nothing to protect
    /// here — but there is also nothing to be gained by describing it twice.
    #[error("this registry does not accept that token")]
    UnknownToken,

    #[error("the owner's public key must be 33 compressed bytes")]
    BadPubkey,

    #[error("that signature does not belong to this name's owner")]
    BadSignature,

    #[error("expected nonce {expected}")]
    ReplayedNonce { expected: u64 },

    #[error("there is nothing to withdraw")]
    NothingToWithdraw,

    #[error("that is more than this name holds")]
    InsufficientBalance,
}

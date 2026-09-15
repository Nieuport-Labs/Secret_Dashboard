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
}

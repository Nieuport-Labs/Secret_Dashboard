use crate::error::ContractError;

pub const MIN_LABEL: usize = 3;
pub const MAX_LABEL: usize = 32;

/// Normalise and check a name.
///
/// ASCII only, and that is a security decision rather than laziness. A name
/// service whose labels can carry Unicode has a homograph problem: `аlice` with
/// a Cyrillic а renders identically to `alice` in every font a person will read
/// it in, and the whole point of a name here is that someone types what they
/// were told and reaches who they meant. Normalisation forms (NFKC and friends)
/// narrow that gap without closing it. Refusing everything outside
/// `[a-z0-9-]` closes it.
///
/// Case is folded rather than rejected, because `Alice` and `alice` are not
/// confusable — they are the same name typed by someone who capitalises names.
/// Everything else is refused rather than rewritten: a registration that
/// silently became a different string than the one the user typed is exactly
/// the shape of a phishing bug.
pub fn normalise(label: &str) -> Result<String, ContractError> {
    let trimmed = label.trim();

    if !trimmed.is_ascii() {
        return Err(ContractError::BadLabel {
            reason: "may only contain a-z, 0-9 and hyphens",
        });
    }

    let folded = trimmed.to_ascii_lowercase();

    if folded.len() < MIN_LABEL {
        return Err(ContractError::BadLabel {
            reason: "is shorter than 3 characters",
        });
    }
    if folded.len() > MAX_LABEL {
        return Err(ContractError::BadLabel {
            reason: "is longer than 32 characters",
        });
    }
    if !folded
        .bytes()
        .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
    {
        return Err(ContractError::BadLabel {
            reason: "may only contain a-z, 0-9 and hyphens",
        });
    }
    if folded.starts_with('-') || folded.ends_with('-') {
        return Err(ContractError::BadLabel {
            reason: "may not start or end with a hyphen",
        });
    }

    Ok(folded)
}

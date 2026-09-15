use cosmwasm_std::{
    entry_point, to_binary, Binary, Deps, DepsMut, Env, MessageInfo, Response, StdResult,
};

use crate::error::ContractError;
use crate::msg::{
    ExecuteMsg, InstantiateMsg, ProfileEntry, ProfileResponse, ProfilesResponse, QueryMsg,
};
use crate::state::{profiles, profiles_read, Link, Profile};

/// Room for a name someone would actually introduce themselves by, not a
/// paragraph wearing a name's clothes.
pub const MAX_NAME: usize = 32;
pub const MAX_BIO: usize = 280;
pub const MAX_LINKS: usize = 8;
pub const MAX_LINK_KIND: usize = 16;
pub const MAX_LINK_VALUE: usize = 200;

/// The avatar's ceiling, in bytes of base64.
///
/// A 64px square WebP lands around 2-4 kB encoded; this leaves room for a noisy
/// photograph that compresses badly without leaving room for someone to park a
/// megabyte of anything in contract state. Storage on this chain is paid once
/// and read forever, so the limit is the whole defence.
pub const MAX_AVATAR: usize = 12_288;

const AVATAR_PREFIX: &str = "data:image/webp;base64,";

#[entry_point]
pub fn instantiate(
    _deps: DepsMut,
    _env: Env,
    _info: MessageInfo,
    _msg: InstantiateMsg,
) -> Result<Response, ContractError> {
    // Nothing to configure. There is no admin either: the contract has no
    // privileged action to perform, and an admin key able to edit other
    // people's profiles would be a liability with no matching use.
    Ok(Response::default())
}

#[entry_point]
pub fn execute(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    msg: ExecuteMsg,
) -> Result<Response, ContractError> {
    match msg {
        ExecuteMsg::Set {
            name,
            bio,
            avatar,
            links,
        } => execute_set(deps, env, info, name, bio, avatar, links),
        ExecuteMsg::Clear {} => execute_clear(deps, info),
    }
}

/// Write the sender's profile, replacing whatever was there.
///
/// The sender is the only key: there is no `owner` argument anywhere in this
/// contract, so there is no message shape that writes to somebody else's entry.
fn execute_set(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    name: String,
    bio: String,
    avatar: String,
    links: Vec<Link>,
) -> Result<Response, ContractError> {
    let profile = Profile {
        name: name.trim().to_string(),
        bio: bio.trim().to_string(),
        avatar: avatar.trim().to_string(),
        links: links
            .into_iter()
            .map(|link| Link {
                kind: link.kind.trim().to_lowercase(),
                value: link.value.trim().to_string(),
            })
            // A link with nothing in it is the form's empty row, not a link.
            .filter(|link| !link.value.is_empty())
            .collect(),
        updated_at: env.block.time.seconds(),
    };

    validate(&profile)?;

    profiles(deps.storage).save(info.sender.as_bytes(), &profile)?;

    Ok(Response::new().add_attribute("action", "set_profile"))
}

fn execute_clear(deps: DepsMut, info: MessageInfo) -> Result<Response, ContractError> {
    // Removing an absent key is not an error, and should not be: clearing a
    // profile you never saved has already achieved what you asked for.
    profiles(deps.storage).remove(info.sender.as_bytes());

    Ok(Response::new().add_attribute("action", "clear_profile"))
}

/// Size limits, checked here rather than only in the client.
///
/// The client is a web page anyone can replace with a script that talks to this
/// contract directly, so a limit that lives only in the form is not a limit.
fn validate(profile: &Profile) -> Result<(), ContractError> {
    // Characters, not bytes: a 32-byte limit would cut a Czech name off at 20
    // letters and a Japanese one at 10, which is not the same rule for
    // everyone.
    if profile.name.chars().count() > MAX_NAME {
        return Err(ContractError::TooLong {
            field: "name",
            max: MAX_NAME,
        });
    }

    if profile.bio.chars().count() > MAX_BIO {
        return Err(ContractError::TooLong {
            field: "bio",
            max: MAX_BIO,
        });
    }

    if !profile.avatar.is_empty() {
        if !profile.avatar.starts_with(AVATAR_PREFIX) {
            return Err(ContractError::AvatarNotWebp);
        }
        // Bytes here, unlike the text fields: this one is base64, where a
        // character is a byte, and what is being capped is storage.
        if profile.avatar.len() > MAX_AVATAR {
            return Err(ContractError::AvatarTooLarge { max: MAX_AVATAR });
        }
    }

    if profile.links.len() > MAX_LINKS {
        return Err(ContractError::TooManyLinks { max: MAX_LINKS });
    }

    for link in &profile.links {
        if link.kind.chars().count() > MAX_LINK_KIND {
            return Err(ContractError::TooLong {
                field: "link kind",
                max: MAX_LINK_KIND,
            });
        }
        if link.value.chars().count() > MAX_LINK_VALUE {
            return Err(ContractError::TooLong {
                field: "link value",
                max: MAX_LINK_VALUE,
            });
        }
    }

    Ok(())
}

#[entry_point]
pub fn query(deps: Deps, _env: Env, msg: QueryMsg) -> StdResult<Binary> {
    match msg {
        QueryMsg::Profile { address } => to_binary(&query_profile(deps, address)?),
        QueryMsg::Profiles { addresses } => to_binary(&query_profiles(deps, addresses)?),
    }
}

/// No permit, no viewing key: this is the public half by design. A profile
/// exists so that someone handed a link can see whose it is.
fn query_profile(deps: Deps, address: String) -> StdResult<ProfileResponse> {
    let owner = deps.api.addr_validate(&address)?;

    Ok(ProfileResponse {
        profile: profiles_read(deps.storage).may_load(owner.as_bytes())?,
    })
}

fn query_profiles(deps: Deps, addresses: Vec<String>) -> StdResult<ProfilesResponse> {
    let store = profiles_read(deps.storage);

    let profiles = addresses
        .into_iter()
        .map(|address| {
            let owner = deps.api.addr_validate(&address)?;
            Ok(ProfileEntry {
                profile: store.may_load(owner.as_bytes())?,
                address,
            })
        })
        .collect::<StdResult<Vec<_>>>()?;

    Ok(ProfilesResponse { profiles })
}

#[cfg(test)]
mod tests {
    use super::*;
    use cosmwasm_std::testing::{mock_dependencies, mock_env, mock_info};

    fn named(name: &str) -> ExecuteMsg {
        ExecuteMsg::Set {
            name: name.to_string(),
            bio: String::new(),
            avatar: String::new(),
            links: vec![],
        }
    }

    #[test]
    fn saves_and_reads_back() {
        let mut deps = mock_dependencies();

        execute(
            deps.as_mut(),
            mock_env(),
            mock_info("alice", &[]),
            named("Alice"),
        )
        .unwrap();

        let found = query_profile(deps.as_ref(), "alice".to_string())
            .unwrap()
            .profile
            .unwrap();

        assert_eq!(found.name, "Alice");
        assert_eq!(found.updated_at, mock_env().block.time.seconds());
    }

    #[test]
    fn an_account_with_no_profile_is_not_an_error() {
        let deps = mock_dependencies();

        assert_eq!(
            query_profile(deps.as_ref(), "nobody".to_string())
                .unwrap()
                .profile,
            None
        );
    }

    /// The property the whole design rests on: the sender is the key, so one
    /// account's write cannot land on another's entry.
    #[test]
    fn writes_land_on_the_sender_only() {
        let mut deps = mock_dependencies();

        execute(
            deps.as_mut(),
            mock_env(),
            mock_info("alice", &[]),
            named("Alice"),
        )
        .unwrap();
        execute(
            deps.as_mut(),
            mock_env(),
            mock_info("mallory", &[]),
            named("Also Alice"),
        )
        .unwrap();

        let alice = query_profile(deps.as_ref(), "alice".to_string())
            .unwrap()
            .profile
            .unwrap();

        assert_eq!(alice.name, "Alice");
    }

    #[test]
    fn clearing_removes_it() {
        let mut deps = mock_dependencies();
        let info = mock_info("alice", &[]);

        execute(deps.as_mut(), mock_env(), info.clone(), named("Alice")).unwrap();
        execute(deps.as_mut(), mock_env(), info, ExecuteMsg::Clear {}).unwrap();

        assert_eq!(
            query_profile(deps.as_ref(), "alice".to_string())
                .unwrap()
                .profile,
            None
        );
    }

    #[test]
    fn clearing_a_profile_that_was_never_saved_succeeds() {
        let mut deps = mock_dependencies();

        execute(
            deps.as_mut(),
            mock_env(),
            mock_info("alice", &[]),
            ExecuteMsg::Clear {},
        )
        .unwrap();
    }

    #[test]
    fn rejects_an_over_long_name() {
        let mut deps = mock_dependencies();

        let error = execute(
            deps.as_mut(),
            mock_env(),
            mock_info("alice", &[]),
            named(&"a".repeat(MAX_NAME + 1)),
        )
        .unwrap_err();

        assert!(matches!(
            error,
            ContractError::TooLong { field: "name", .. }
        ));
    }

    /// Multi-byte characters count as one each, so the limit is the same number
    /// of letters whatever alphabet they are written in.
    #[test]
    fn counts_characters_not_bytes() {
        let mut deps = mock_dependencies();

        execute(
            deps.as_mut(),
            mock_env(),
            mock_info("alice", &[]),
            named(&"z".repeat(MAX_NAME)),
        )
        .unwrap();
    }

    #[test]
    fn rejects_an_avatar_that_is_not_webp() {
        let mut deps = mock_dependencies();

        let error = execute(
            deps.as_mut(),
            mock_env(),
            mock_info("alice", &[]),
            ExecuteMsg::Set {
                name: String::new(),
                bio: String::new(),
                avatar: "https://example.com/me.png".to_string(),
                links: vec![],
            },
        )
        .unwrap_err();

        assert!(matches!(error, ContractError::AvatarNotWebp));
    }

    #[test]
    fn rejects_an_oversized_avatar() {
        let mut deps = mock_dependencies();

        let error = execute(
            deps.as_mut(),
            mock_env(),
            mock_info("alice", &[]),
            ExecuteMsg::Set {
                name: String::new(),
                bio: String::new(),
                avatar: format!("{}{}", AVATAR_PREFIX, "A".repeat(MAX_AVATAR)),
                links: vec![],
            },
        )
        .unwrap_err();

        assert!(matches!(error, ContractError::AvatarTooLarge { .. }));
    }

    #[test]
    fn drops_empty_link_rows_and_normalises_the_rest() {
        let mut deps = mock_dependencies();

        execute(
            deps.as_mut(),
            mock_env(),
            mock_info("alice", &[]),
            ExecuteMsg::Set {
                name: String::new(),
                bio: String::new(),
                avatar: String::new(),
                links: vec![
                    Link {
                        kind: "X".to_string(),
                        value: "  alice  ".to_string(),
                    },
                    Link {
                        kind: "telegram".to_string(),
                        value: "   ".to_string(),
                    },
                ],
            },
        )
        .unwrap();

        let links = query_profile(deps.as_ref(), "alice".to_string())
            .unwrap()
            .profile
            .unwrap()
            .links;

        assert_eq!(links.len(), 1);
        assert_eq!(links[0].kind, "x");
        assert_eq!(links[0].value, "alice");
    }

    #[test]
    fn a_batch_keeps_absent_profiles_in_place() {
        let mut deps = mock_dependencies();

        execute(
            deps.as_mut(),
            mock_env(),
            mock_info("alice", &[]),
            named("Alice"),
        )
        .unwrap();

        let found = query_profiles(
            deps.as_ref(),
            vec!["nobody".to_string(), "alice".to_string()],
        )
        .unwrap()
        .profiles;

        assert_eq!(found.len(), 2);
        assert_eq!(found[0].address, "nobody");
        assert!(found[0].profile.is_none());
        assert_eq!(found[1].profile.as_ref().unwrap().name, "Alice");
    }
}

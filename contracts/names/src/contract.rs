use cosmwasm_std::{
    entry_point, from_binary, to_binary, Binary, CosmosMsg, Deps, DepsMut, Env, MessageInfo,
    Response, StdError, StdResult, Uint128, WasmMsg,
};
use sha2::{Digest, Sha256};

use crate::dwb;
use crate::error::ContractError;
use crate::label::normalise;
use crate::msg::{
    Action, AvailableResponse, BalanceResponse, ExecuteMsg, InstantiateMsg, ProfileResponse,
    QueryMsg, ReceiveMsg, Snip20ExecuteMsg,
};
use crate::state::{
    balance_key, balances, balances_read, config, config_read, names, names_read, Config, Link,
    NameRecord, Profile, TokenRef,
};

pub const MAX_NAME: usize = 32;
pub const MAX_BIO: usize = 280;
pub const MAX_LINKS: usize = 8;
pub const MAX_LINK_KIND: usize = 16;
pub const MAX_LINK_VALUE: usize = 200;
pub const MAX_AVATAR: usize = 12_288;

const AVATAR_PREFIX: &str = "data:image/webp;base64,";

/// Signatures are scoped by what they authorise.
///
/// Two domains rather than one so that a signature collected for a balance
/// query can never be presented as authority to move funds. They are separate
/// powers, and a captured one should not become the other.
const DOMAIN_ACTION: &[u8] = b"secret-dashboard-names/v1/action";
const DOMAIN_BALANCE: &[u8] = b"secret-dashboard-names/v1/balance";

/// Outgoing SNIP-20 messages are padded up to a multiple of this.
const PAD_BLOCK: usize = 64;

#[entry_point]
pub fn instantiate(
    deps: DepsMut,
    _env: Env,
    _info: MessageInfo,
    msg: InstantiateMsg,
) -> Result<Response, ContractError> {
    if msg.tokens.is_empty() {
        return Err(ContractError::UnknownToken);
    }
    // One byte of balance key per token, and a list long enough to overflow it
    // would silently alias two tokens' balances onto each other.
    if msg.tokens.len() > u8::MAX as usize {
        return Err(ContractError::UnknownToken);
    }

    let mut tokens: Vec<TokenRef> = Vec::with_capacity(msg.tokens.len());
    for token in msg.tokens {
        let address = deps.api.addr_validate(&token.address)?;
        if tokens.iter().any(|known| known.address == address) {
            return Err(ContractError::UnknownToken);
        }
        tokens.push(TokenRef {
            address,
            code_hash: token.code_hash,
        });
    }

    config(deps.storage).save(&Config { tokens })?;

    // No admin, deliberately, and for the same reason as `contracts/profile`:
    // there is no privileged action here, and a key able to migrate this code
    // could point every future withdrawal at a contract of its own choosing.
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
        ExecuteMsg::Register {
            label,
            owner_pubkey,
        } => execute_register(deps, env, label, owner_pubkey),
        ExecuteMsg::Authorise {
            label,
            nonce,
            action,
            signature,
        } => execute_authorise(deps, env, label, nonce, action, signature),
        ExecuteMsg::Receive {
            amount, msg: inner, ..
        } => execute_receive(deps, env, info, amount, inner),
    }
}

fn execute_register(
    deps: DepsMut,
    env: Env,
    label: String,
    owner_pubkey: Binary,
) -> Result<Response, ContractError> {
    let label = normalise(&label)?;
    check_pubkey(&owner_pubkey)?;

    if names_read(deps.storage)
        .may_load(label.as_bytes())?
        .is_some()
    {
        return Err(ContractError::LabelTaken);
    }

    names(deps.storage).save(
        label.as_bytes(),
        &NameRecord {
            owner_pubkey,
            nonce: 0,
            profile: Profile::default(),
            created_at: env.block.time.seconds(),
        },
    )?;

    Ok(Response::new().add_attribute("action", "register"))
}

/// The one gate every owner action passes through.
fn execute_authorise(
    deps: DepsMut,
    env: Env,
    label: String,
    nonce: u64,
    action: Action,
    signature: Binary,
) -> Result<Response, ContractError> {
    let label = normalise(&label)?;
    let mut record = names_read(deps.storage)
        .may_load(label.as_bytes())?
        .ok_or(ContractError::NoSuchLabel)?;

    if nonce != record.nonce {
        return Err(ContractError::ReplayedNonce {
            expected: record.nonce,
        });
    }

    let digest = action_digest(&env, &label, nonce, &to_binary(&action)?);
    if !deps
        .api
        .secp256k1_verify(
            &digest,
            signature.as_slice(),
            record.owner_pubkey.as_slice(),
        )
        .unwrap_or(false)
    {
        return Err(ContractError::BadSignature);
    }

    // Before the action, not after. A failing action reverts the whole
    // transaction anyway, and bumping first means there is no path through this
    // function that accepts a signature without spending its nonce.
    record.nonce += 1;
    names(deps.storage).save(label.as_bytes(), &record)?;

    match action {
        Action::SetProfile {
            name,
            bio,
            avatar,
            links,
        } => set_profile(deps, env, label, record, name, bio, avatar, links),
        Action::Withdraw { token, amount, to } => withdraw(deps, label, token, amount, to),
        Action::TransferName { new_owner_pubkey } => {
            transfer_name(deps, label, record, new_owner_pubkey)
        }
        Action::Release {} => release(deps, label),
    }
}

#[allow(clippy::too_many_arguments)]
fn set_profile(
    deps: DepsMut,
    env: Env,
    label: String,
    mut record: NameRecord,
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

    record.profile = profile;
    names(deps.storage).save(label.as_bytes(), &record)?;

    Ok(Response::new().add_attribute("action", "set_profile"))
}

/// Pay a name out.
///
/// This is the only place an address belonging to the owner is written into an
/// outgoing message, and it has to be here rather than in the tipper's
/// transaction. A contract's outgoing `Execute` messages are encrypted with the
/// *transaction sender's* key — `docs/protocol/encryption-specs.md`, the Output
/// section, encrypts them under `tx_encryption_key`, which only the original
/// signer can derive. A registry that resolved the name and forwarded the funds
/// in one step would therefore be handing the tipper a message they can
/// decrypt, containing exactly the address the name exists to withhold.
///
/// Here the signer is the owner, and an owner learning their own address is not
/// a leak.
fn withdraw(
    deps: DepsMut,
    label: String,
    token: String,
    amount: Option<Uint128>,
    to: String,
) -> Result<Response, ContractError> {
    let settings = config_read(deps.storage).load()?;
    let index = settings
        .index_of(&token)
        .ok_or(ContractError::UnknownToken)?;
    let recipient = deps.api.addr_validate(&to)?;

    // Anything still buffered is owed to this name, and this transaction is the
    // owner's own — the one moment when writing these keys tells an observer
    // nothing the signer did not already know.
    dwb::settle(deps.storage, &label)?;

    let key = balance_key(&label, index);
    let held = balances_read(deps.storage)
        .may_load(&key)?
        .unwrap_or_default();

    let taking = amount.unwrap_or(held);
    if taking.is_zero() {
        return Err(ContractError::NothingToWithdraw);
    }
    if taking > held {
        return Err(ContractError::InsufficientBalance);
    }

    balances(deps.storage).save(&key, &(held - taking))?;

    let token = &settings.tokens[index as usize];
    Ok(Response::new()
        .add_message(CosmosMsg::Wasm(WasmMsg::Execute {
            contract_addr: token.address.to_string(),
            code_hash: token.code_hash.clone(),
            msg: transfer_msg(recipient.into_string(), taking)?,
            funds: vec![],
        }))
        .add_attribute("action", "withdraw"))
}

fn transfer_name(
    deps: DepsMut,
    label: String,
    mut record: NameRecord,
    new_owner_pubkey: Binary,
) -> Result<Response, ContractError> {
    check_pubkey(&new_owner_pubkey)?;

    // The nonce is not reset. It means nothing to the new key beyond "start
    // here", and a counter that goes backwards is one more thing to reason
    // about the next time a signature is refused.
    record.owner_pubkey = new_owner_pubkey;
    names(deps.storage).save(label.as_bytes(), &record)?;

    Ok(Response::new().add_attribute("action", "transfer_name"))
}

fn release(deps: DepsMut, label: String) -> Result<Response, ContractError> {
    let settings = config_read(deps.storage).load()?;

    // Settle first, or a credit still sitting in the buffer would be released
    // along with the name and belong to nobody.
    dwb::settle(deps.storage, &label)?;

    for index in 0..settings.tokens.len() as u8 {
        let held = balances_read(deps.storage)
            .may_load(&balance_key(&label, index))?
            .unwrap_or_default();
        if !held.is_zero() {
            return Err(ContractError::InsufficientBalance);
        }
    }

    names(deps.storage).remove(label.as_bytes());

    Ok(Response::new().add_attribute("action", "release"))
}

/// A tip, arriving from the token contract rather than from the tipper.
fn execute_receive(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    amount: Uint128,
    msg: Option<Binary>,
) -> Result<Response, ContractError> {
    let settings = config_read(deps.storage).load()?;
    // `info.sender` is the token, and checking it is what makes a credit mean
    // anything: without this, anyone could call `receive` directly and mint
    // themselves a balance out of a JSON literal.
    let index = settings
        .index_of(info.sender.as_str())
        .ok_or(ContractError::UnknownToken)?;

    let ReceiveMsg::Tip { label } = from_binary(&msg.ok_or(ContractError::NoSuchLabel)?)?;
    let label = normalise(&label)?;

    // Refusing an unknown name reverts the whole transaction, which returns the
    // tokens. Accepting it would leave them credited to a name nobody can ever
    // hold the key for.
    if names_read(deps.storage)
        .may_load(label.as_bytes())?
        .is_none()
    {
        return Err(ContractError::NoSuchLabel);
    }
    if amount.is_zero() {
        return Err(ContractError::NothingToWithdraw);
    }

    dwb::credit(deps.storage, &env, &label, index, amount)?;

    // No attribute naming the label. Log values are encrypted to the tipper,
    // who already knows it, but the number and shape of a contract's events are
    // visible to everyone, and there is nothing here worth announcing.
    Ok(Response::new().add_attribute("action", "receive"))
}

#[entry_point]
pub fn query(deps: Deps, env: Env, msg: QueryMsg) -> StdResult<Binary> {
    match msg {
        QueryMsg::Profile { label } => to_binary(&query_profile(deps, label)?),
        QueryMsg::Available { label } => to_binary(&query_available(deps, label)?),
        QueryMsg::Balance {
            label,
            token,
            nonce,
            signature,
        } => to_binary(&query_balance(deps, env, label, token, nonce, signature)?),
    }
}

/// The public half, and the only thing a stranger can read.
///
/// Note what is *not* returned: `owner_pubkey`, the nonce, and every balance. A
/// name does not resolve to an address here or anywhere else, because no
/// address belonging to an owner is stored in the first place.
fn query_profile(deps: Deps, label: String) -> StdResult<ProfileResponse> {
    // A malformed name is answered as an absent one. Distinguishing them would
    // let a caller probe the validator rather than the registry, and "no such
    // name" is true either way.
    let Ok(label) = normalise(&label) else {
        return Ok(ProfileResponse { profile: None });
    };

    Ok(ProfileResponse {
        profile: names_read(deps.storage)
            .may_load(label.as_bytes())?
            .map(|record| record.profile),
    })
}

fn query_available(deps: Deps, label: String) -> StdResult<AvailableResponse> {
    // A name that could never be registered is not available, which is both
    // true and the answer that keeps a caller from treating this as a syntax
    // checker.
    let Ok(label) = normalise(&label) else {
        return Ok(AvailableResponse { available: false });
    };

    Ok(AvailableResponse {
        available: names_read(deps.storage)
            .may_load(label.as_bytes())?
            .is_none(),
    })
}

fn query_balance(
    deps: Deps,
    env: Env,
    label: String,
    token: String,
    nonce: u64,
    signature: Binary,
) -> StdResult<BalanceResponse> {
    let label = normalise(&label).map_err(|error| StdError::generic_err(error.to_string()))?;
    let record = names_read(deps.storage)
        .may_load(label.as_bytes())?
        .ok_or_else(|| StdError::generic_err("no such name"))?;

    if nonce != record.nonce {
        return Err(StdError::generic_err("stale nonce"));
    }

    let digest = balance_digest(&env, &label, nonce, &token);
    if !deps
        .api
        .secp256k1_verify(
            &digest,
            signature.as_slice(),
            record.owner_pubkey.as_slice(),
        )
        .unwrap_or(false)
    {
        return Err(StdError::generic_err("bad signature"));
    }

    let settings = config_read(deps.storage).load()?;
    let index = settings
        .index_of(&token)
        .ok_or_else(|| StdError::generic_err("unknown token"))?;

    let settled = balances_read(deps.storage)
        .may_load(&balance_key(&label, index))?
        .unwrap_or_default();

    // Buffered credits count towards what a name holds even though they have
    // not been written yet. Otherwise the owner would watch a tip vanish and
    // reappear at a moment they cannot predict.
    Ok(BalanceResponse {
        amount: settled + dwb::pending(&dwb::load(deps.storage)?, &label, index),
    })
}

/// What an owner signs to authorise an action.
///
/// Domain-separated and bound to this contract and this chain, so a signature
/// cannot be lifted onto a second deployment or a testnet twin. Every variable
/// part is length-prefixed, so no two different sets of fields can hash to the
/// same bytes.
fn action_digest(env: &Env, label: &str, nonce: u64, action: &Binary) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(DOMAIN_ACTION);
    field(&mut hasher, env.block.chain_id.as_bytes());
    field(&mut hasher, env.contract.address.as_bytes());
    field(&mut hasher, label.as_bytes());
    hasher.update(nonce.to_be_bytes());
    field(&mut hasher, action.as_slice());
    hasher.finalize().into()
}

fn balance_digest(env: &Env, label: &str, nonce: u64, token: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(DOMAIN_BALANCE);
    field(&mut hasher, env.block.chain_id.as_bytes());
    field(&mut hasher, env.contract.address.as_bytes());
    field(&mut hasher, label.as_bytes());
    hasher.update(nonce.to_be_bytes());
    field(&mut hasher, token.as_bytes());
    hasher.finalize().into()
}

fn field(hasher: &mut Sha256, bytes: &[u8]) {
    hasher.update((bytes.len() as u32).to_be_bytes());
    hasher.update(bytes);
}

fn check_pubkey(pubkey: &Binary) -> Result<(), ContractError> {
    let bytes = pubkey.as_slice();
    if bytes.len() != 33 || !matches!(bytes[0], 0x02 | 0x03) {
        return Err(ContractError::BadPubkey);
    }
    Ok(())
}

/// A transfer, brought up to a constant length.
///
/// Encryption hides the contents of an outgoing message but not its size, and
/// an amount is anywhere between one and twenty digits. Padding to a fixed
/// block makes every withdrawal this contract emits look the same from outside.
fn transfer_msg(recipient: String, amount: Uint128) -> StdResult<Binary> {
    let mut msg = Snip20ExecuteMsg::Transfer {
        recipient,
        amount,
        padding: String::new(),
    };

    let bare = to_binary(&msg)?.len();
    let target = bare.div_ceil(PAD_BLOCK) * PAD_BLOCK;

    match &mut msg {
        Snip20ExecuteMsg::Transfer { padding, .. } => *padding = " ".repeat(target - bare),
    }

    to_binary(&msg)
}

fn validate(profile: &Profile) -> Result<(), ContractError> {
    // Characters, not bytes: a 32-byte limit would cut a Czech name off at 20
    // letters and a Japanese one at 10, which is not the same rule for
    // everyone. (The *label* is ASCII-only, for a different reason — see
    // `label.rs` — but a display name has no lookalike problem to solve.)
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::msg::TokenInit;
    use cosmwasm_std::testing::{
        mock_dependencies, mock_env, mock_info, MockApi, MockQuerier, MockStorage,
    };
    use cosmwasm_std::{Addr, OwnedDeps, Storage};
    use k256::ecdsa::signature::hazmat::PrehashSigner;
    use k256::ecdsa::{Signature, SigningKey};

    const TOKEN: &str = "secret1token9qe5t7dllmpxu0wmjyhq4x2sk8h9x";
    const TOKEN_B: &str = "secret1tokenb3p4z0nm7wqcv6sxe2ly9dgk4ufjr";
    const STRANGER: &str = "secret1stranger6t8kqzx2vy4nlw0md7jce5hpb9";
    const RELAY: &str = "secret1relay4dm8w2ptzx6kqjn3sf0ul9cvehy7g";
    const PAYOUT: &str = "secret1payout5nq3kzr8we2ldt7mcx0vjfsgh4yb";
    const TIPPER: &str = "secret1tipper7wq2mkz9xn4vdl0trs6cjyeh3gpf";

    fn key(seed: u8) -> SigningKey {
        SigningKey::from_slice(&[seed; 32]).unwrap()
    }

    fn pubkey(signing: &SigningKey) -> Binary {
        Binary::from(
            signing
                .verifying_key()
                .to_encoded_point(true)
                .as_bytes()
                .to_vec(),
        )
    }

    fn sign(signing: &SigningKey, digest: &[u8; 32]) -> Binary {
        let signature: Signature = signing.sign_prehash(digest).unwrap();
        Binary::from(signature.to_bytes().to_vec())
    }

    fn setup() -> OwnedDeps<MockStorage, MockApi, MockQuerier> {
        let mut deps = mock_dependencies();
        instantiate(
            deps.as_mut(),
            mock_env(),
            mock_info(STRANGER, &[]),
            InstantiateMsg {
                tokens: vec![
                    TokenInit {
                        address: TOKEN.to_string(),
                        code_hash: "aa".repeat(32),
                    },
                    TokenInit {
                        address: TOKEN_B.to_string(),
                        code_hash: "bb".repeat(32),
                    },
                ],
            },
        )
        .unwrap();
        deps
    }

    fn register(deps: DepsMut, label: &str, signing: &SigningKey) {
        execute(
            deps,
            mock_env(),
            // Registered by a stranger on purpose: the address that sends this
            // is not the owner, and nothing downstream may assume it is.
            mock_info(STRANGER, &[]),
            ExecuteMsg::Register {
                label: label.to_string(),
                owner_pubkey: pubkey(signing),
            },
        )
        .unwrap();
    }

    fn authorise(
        deps: DepsMut,
        env: &Env,
        signing: &SigningKey,
        label: &str,
        nonce: u64,
        action: Action,
    ) -> Result<Response, ContractError> {
        let digest = action_digest(env, label, nonce, &to_binary(&action).unwrap());
        let signature = sign(signing, &digest);
        execute(
            deps,
            env.clone(),
            mock_info(RELAY, &[]),
            ExecuteMsg::Authorise {
                label: label.to_string(),
                nonce,
                action,
                signature,
            },
        )
    }

    fn tip(
        deps: DepsMut,
        env: Env,
        token: &str,
        label: &str,
        amount: u128,
    ) -> Result<Response, ContractError> {
        execute(
            deps,
            env,
            mock_info(token, &[]),
            ExecuteMsg::Receive {
                sender: TIPPER.to_string(),
                from: TIPPER.to_string(),
                amount: Uint128::new(amount),
                msg: Some(
                    to_binary(&ReceiveMsg::Tip {
                        label: label.to_string(),
                    })
                    .unwrap(),
                ),
            },
        )
    }

    fn settled(storage: &dyn Storage, label: &str, token: u8) -> Option<Uint128> {
        balances_read(storage)
            .may_load(&balance_key(label, token))
            .unwrap()
    }

    #[test]
    fn a_name_can_be_registered_and_read_back() {
        let mut deps = setup();
        let owner = key(1);
        register(deps.as_mut(), "alice", &owner);

        let env = mock_env();
        authorise(
            deps.as_mut(),
            &env,
            &owner,
            "alice",
            0,
            Action::SetProfile {
                name: "Alice".to_string(),
                bio: "  hello  ".to_string(),
                avatar: String::new(),
                links: vec![],
            },
        )
        .unwrap();

        let response: ProfileResponse = from_binary(
            &query(
                deps.as_ref(),
                mock_env(),
                QueryMsg::Profile {
                    label: "alice".to_string(),
                },
            )
            .unwrap(),
        )
        .unwrap();

        let profile = response.profile.unwrap();
        assert_eq!(profile.name, "Alice");
        assert_eq!(profile.bio, "hello");
    }

    /// The property the whole design rests on: the public answer about a name
    /// carries nothing that points back at whoever holds it.
    #[test]
    fn a_profile_query_never_carries_the_owner_key() {
        let mut deps = setup();
        let owner = key(2);
        register(deps.as_mut(), "alice", &owner);

        let raw = query(
            deps.as_ref(),
            mock_env(),
            QueryMsg::Profile {
                label: "alice".to_string(),
            },
        )
        .unwrap();

        let json = String::from_utf8(raw.to_vec()).unwrap();
        assert!(!json.contains(&pubkey(&owner).to_base64()));
        assert!(!json.contains("owner"));
        assert!(!json.contains("nonce"));
    }

    #[test]
    fn a_taken_name_cannot_be_registered_again() {
        let mut deps = setup();
        register(deps.as_mut(), "alice", &key(1));

        let error = execute(
            deps.as_mut(),
            mock_env(),
            mock_info(STRANGER, &[]),
            ExecuteMsg::Register {
                label: "ALICE".to_string(),
                owner_pubkey: pubkey(&key(2)),
            },
        )
        .unwrap_err();

        assert!(matches!(error, ContractError::LabelTaken));
    }

    #[test]
    fn labels_are_folded_and_checked() {
        assert_eq!(normalise("Alice").unwrap(), "alice");
        assert_eq!(normalise("  bob-2  ").unwrap(), "bob-2");

        // Confusables are the reason this is ASCII-only: the Cyrillic а below
        // is a different name that reads as the same one.
        assert!(normalise("аlice").is_err());
        assert!(normalise("ab").is_err());
        assert!(normalise(&"a".repeat(33)).is_err());
        assert!(normalise("-alice").is_err());
        assert!(normalise("alice-").is_err());
        assert!(normalise("al ice").is_err());
        assert!(normalise("al_ice").is_err());
    }

    #[test]
    fn a_replayed_nonce_is_refused() {
        let mut deps = setup();
        let owner = key(3);
        register(deps.as_mut(), "alice", &owner);
        let env = mock_env();

        let action = Action::SetProfile {
            name: "Alice".to_string(),
            bio: String::new(),
            avatar: String::new(),
            links: vec![],
        };
        let digest = action_digest(&env, "alice", 0, &to_binary(&action).unwrap());
        let signature = sign(&owner, &digest);

        let replay = ExecuteMsg::Authorise {
            label: "alice".to_string(),
            nonce: 0,
            action,
            signature,
        };

        execute(
            deps.as_mut(),
            env.clone(),
            mock_info(RELAY, &[]),
            replay.clone(),
        )
        .unwrap();

        let error = execute(deps.as_mut(), env, mock_info(RELAY, &[]), replay).unwrap_err();
        assert!(matches!(
            error,
            ContractError::ReplayedNonce { expected: 1 }
        ));
    }

    #[test]
    fn a_signature_from_another_key_is_refused() {
        let mut deps = setup();
        register(deps.as_mut(), "alice", &key(4));

        let error = authorise(
            deps.as_mut(),
            &mock_env(),
            &key(5),
            "alice",
            0,
            Action::Release {},
        )
        .unwrap_err();

        assert!(matches!(error, ContractError::BadSignature));
    }

    /// A signature is scoped to one name, one chain and one deployment, so a
    /// copy of it is worthless everywhere else.
    #[test]
    fn a_signature_is_bound_to_the_name_the_chain_and_the_contract() {
        let mut deps = setup();
        let owner = key(6);
        register(deps.as_mut(), "alice", &owner);
        register(deps.as_mut(), "bob", &owner);

        let env = mock_env();
        let action = Action::Release {};
        let body = to_binary(&action).unwrap();

        // Signed for "bob", presented for "alice".
        let wrong_name = sign(&owner, &action_digest(&env, "bob", 0, &body));

        let mut elsewhere = env.clone();
        elsewhere.block.chain_id = "pulsar-3".to_string();
        let wrong_chain = sign(&owner, &action_digest(&elsewhere, "alice", 0, &body));

        let mut twin = env.clone();
        twin.contract.address = Addr::unchecked(STRANGER);
        let wrong_contract = sign(&owner, &action_digest(&twin, "alice", 0, &body));

        for signature in [wrong_name, wrong_chain, wrong_contract] {
            let error = execute(
                deps.as_mut(),
                env.clone(),
                mock_info(RELAY, &[]),
                ExecuteMsg::Authorise {
                    label: "alice".to_string(),
                    nonce: 0,
                    action: action.clone(),
                    signature,
                },
            )
            .unwrap_err();
            assert!(matches!(error, ContractError::BadSignature));
        }
    }

    #[test]
    fn transferring_a_name_invalidates_the_old_key() {
        let mut deps = setup();
        let first = key(7);
        let second = key(8);
        register(deps.as_mut(), "alice", &first);
        let env = mock_env();

        authorise(
            deps.as_mut(),
            &env,
            &first,
            "alice",
            0,
            Action::TransferName {
                new_owner_pubkey: pubkey(&second),
            },
        )
        .unwrap();

        let error =
            authorise(deps.as_mut(), &env, &first, "alice", 1, Action::Release {}).unwrap_err();
        assert!(matches!(error, ContractError::BadSignature));

        authorise(deps.as_mut(), &env, &second, "alice", 1, Action::Release {}).unwrap();
    }

    #[test]
    fn a_tip_from_an_unlisted_token_is_refused() {
        let mut deps = setup();
        register(deps.as_mut(), "alice", &key(9));

        // Straight from an address pretending to be a token: without the
        // allowlist check this would mint a balance out of a JSON literal.
        let error = tip(deps.as_mut(), mock_env(), STRANGER, "alice", 100).unwrap_err();
        assert!(matches!(error, ContractError::UnknownToken));
    }

    #[test]
    fn a_tip_to_an_unknown_name_is_refused() {
        let mut deps = setup();

        let error = tip(deps.as_mut(), mock_env(), TOKEN, "nobody", 100).unwrap_err();
        assert!(matches!(error, ContractError::NoSuchLabel));
    }

    /// The delayed write buffer's reason for existing: a tip must not write the
    /// balance key of the name it was sent to, or an observer who can see which
    /// encrypted keys a transaction touched can join the tip to the withdrawal.
    #[test]
    fn a_tip_does_not_write_the_balance_of_the_name_it_is_for() {
        let mut deps = setup();
        register(deps.as_mut(), "alice", &key(10));

        tip(deps.as_mut(), mock_env(), TOKEN, "alice", 500).unwrap();

        assert_eq!(settled(deps.as_ref().storage, "alice", 0), None);
        assert_eq!(
            dwb::pending(&dwb::load(deps.as_ref().storage).unwrap(), "alice", 0),
            Uint128::new(500)
        );
    }

    /// And the other half of that property: which slot a credit lands in is a
    /// function of the block and the buffer, never of who the credit is for.
    #[test]
    fn the_slot_a_credit_lands_in_does_not_depend_on_who_it_is_for() {
        let occupied = |label: &str| {
            let mut deps = setup();
            register(deps.as_mut(), label, &key(11));
            tip(deps.as_mut(), mock_env(), TOKEN, label, 1).unwrap();
            let buffer = dwb::load(deps.as_ref().storage).unwrap();
            buffer
                .slots
                .iter()
                .position(|slot| !slot.is_free())
                .unwrap()
        };

        assert_eq!(occupied("alice"), occupied("zebulon"));
    }

    #[test]
    fn an_evicted_credit_is_settled_rather_than_lost() {
        let mut deps = setup();
        register(deps.as_mut(), "alice", &key(12));

        // Far more tips than there are slots, so eviction is certain.
        let rounds = (dwb::SLOTS * 4) as u64;
        for round in 0..rounds {
            let mut env = mock_env();
            env.block.height += round;
            tip(deps.as_mut(), env, TOKEN, "alice", 7).unwrap();
        }

        let in_buffer = dwb::pending(&dwb::load(deps.as_ref().storage).unwrap(), "alice", 0);
        let on_record = settled(deps.as_ref().storage, "alice", 0).unwrap_or_default();

        assert!(!on_record.is_zero(), "nothing was ever evicted and settled");
        assert_eq!(in_buffer + on_record, Uint128::new(7 * rounds as u128));
    }

    #[test]
    fn tips_are_kept_apart_by_token() {
        let mut deps = setup();
        register(deps.as_mut(), "alice", &key(13));

        tip(deps.as_mut(), mock_env(), TOKEN, "alice", 100).unwrap();
        let mut later = mock_env();
        later.block.height += 1;
        tip(deps.as_mut(), later, TOKEN_B, "alice", 250).unwrap();

        let buffer = dwb::load(deps.as_ref().storage).unwrap();
        assert_eq!(dwb::pending(&buffer, "alice", 0), Uint128::new(100));
        assert_eq!(dwb::pending(&buffer, "alice", 1), Uint128::new(250));
    }

    #[test]
    fn withdrawing_emits_one_transfer_to_the_address_the_owner_chose() {
        let mut deps = setup();
        let owner = key(14);
        register(deps.as_mut(), "alice", &owner);
        tip(deps.as_mut(), mock_env(), TOKEN, "alice", 900).unwrap();

        let response = authorise(
            deps.as_mut(),
            &mock_env(),
            &owner,
            "alice",
            0,
            Action::Withdraw {
                token: TOKEN.to_string(),
                amount: None,
                to: PAYOUT.to_string(),
            },
        )
        .unwrap();

        assert_eq!(response.messages.len(), 1);
        let CosmosMsg::Wasm(WasmMsg::Execute {
            contract_addr, msg, ..
        }) = &response.messages[0].msg
        else {
            panic!("expected a wasm execute")
        };
        assert_eq!(contract_addr, TOKEN);

        let Snip20ExecuteMsg::Transfer {
            recipient, amount, ..
        } = from_binary(msg).unwrap();
        assert_eq!(recipient, PAYOUT);
        assert_eq!(amount, Uint128::new(900));

        // Padded, so the digits of the amount do not show through the
        // ciphertext length.
        assert_eq!(msg.len() % PAD_BLOCK, 0);

        assert_eq!(
            settled(deps.as_ref().storage, "alice", 0),
            Some(Uint128::zero())
        );
    }

    #[test]
    fn a_withdrawal_takes_the_buffer_with_it() {
        let mut deps = setup();
        let owner = key(15);
        register(deps.as_mut(), "alice", &owner);

        for round in 0..3u64 {
            let mut env = mock_env();
            env.block.height += round;
            tip(deps.as_mut(), env, TOKEN, "alice", 100).unwrap();
        }

        let response = authorise(
            deps.as_mut(),
            &mock_env(),
            &owner,
            "alice",
            0,
            Action::Withdraw {
                token: TOKEN.to_string(),
                amount: None,
                to: PAYOUT.to_string(),
            },
        )
        .unwrap();

        let CosmosMsg::Wasm(WasmMsg::Execute { msg, .. }) = &response.messages[0].msg else {
            panic!("expected a wasm execute")
        };
        let Snip20ExecuteMsg::Transfer { amount, .. } = from_binary(msg).unwrap();
        assert_eq!(amount, Uint128::new(300));
    }

    #[test]
    fn withdrawing_more_than_a_name_holds_is_refused() {
        let mut deps = setup();
        let owner = key(16);
        register(deps.as_mut(), "alice", &owner);
        tip(deps.as_mut(), mock_env(), TOKEN, "alice", 100).unwrap();

        let error = authorise(
            deps.as_mut(),
            &mock_env(),
            &owner,
            "alice",
            0,
            Action::Withdraw {
                token: TOKEN.to_string(),
                amount: Some(Uint128::new(101)),
                to: PAYOUT.to_string(),
            },
        )
        .unwrap_err();

        assert!(matches!(error, ContractError::InsufficientBalance));
    }

    #[test]
    fn withdrawing_a_token_this_registry_does_not_accept_is_refused() {
        let mut deps = setup();
        let owner = key(17);
        register(deps.as_mut(), "alice", &owner);

        let error = authorise(
            deps.as_mut(),
            &mock_env(),
            &owner,
            "alice",
            0,
            Action::Withdraw {
                token: STRANGER.to_string(),
                amount: None,
                to: PAYOUT.to_string(),
            },
        )
        .unwrap_err();

        assert!(matches!(error, ContractError::UnknownToken));
    }

    #[test]
    fn a_name_still_holding_something_cannot_be_released() {
        let mut deps = setup();
        let owner = key(18);
        register(deps.as_mut(), "alice", &owner);
        tip(deps.as_mut(), mock_env(), TOKEN, "alice", 5).unwrap();

        let error = authorise(
            deps.as_mut(),
            &mock_env(),
            &owner,
            "alice",
            0,
            Action::Release {},
        )
        .unwrap_err();
        assert!(matches!(error, ContractError::InsufficientBalance));
    }

    #[test]
    fn releasing_frees_the_name() {
        let mut deps = setup();
        let owner = key(19);
        register(deps.as_mut(), "alice", &owner);

        authorise(
            deps.as_mut(),
            &mock_env(),
            &owner,
            "alice",
            0,
            Action::Release {},
        )
        .unwrap();

        let response: AvailableResponse = from_binary(
            &query(
                deps.as_ref(),
                mock_env(),
                QueryMsg::Available {
                    label: "alice".to_string(),
                },
            )
            .unwrap(),
        )
        .unwrap();
        assert!(response.available);
    }

    #[test]
    fn an_owner_can_read_their_balance_and_nobody_else_can() {
        let mut deps = setup();
        let owner = key(20);
        register(deps.as_mut(), "alice", &owner);
        tip(deps.as_mut(), mock_env(), TOKEN, "alice", 420).unwrap();

        let env = mock_env();
        let digest = balance_digest(&env, "alice", 0, TOKEN);

        let response: BalanceResponse = from_binary(
            &query(
                deps.as_ref(),
                env.clone(),
                QueryMsg::Balance {
                    label: "alice".to_string(),
                    token: TOKEN.to_string(),
                    nonce: 0,
                    signature: sign(&owner, &digest),
                },
            )
            .unwrap(),
        )
        .unwrap();
        // Counted even though it is still in the buffer.
        assert_eq!(response.amount, Uint128::new(420));

        let refused = query(
            deps.as_ref(),
            env,
            QueryMsg::Balance {
                label: "alice".to_string(),
                token: TOKEN.to_string(),
                nonce: 0,
                signature: sign(&key(21), &digest),
            },
        );
        assert!(refused.is_err());
    }

    #[test]
    fn a_registry_that_accepts_nothing_is_refused() {
        let mut deps = mock_dependencies();
        let error = instantiate(
            deps.as_mut(),
            mock_env(),
            mock_info(STRANGER, &[]),
            InstantiateMsg { tokens: vec![] },
        )
        .unwrap_err();

        assert!(matches!(error, ContractError::UnknownToken));
    }

    #[test]
    fn an_owner_key_that_is_not_a_compressed_point_is_refused() {
        let mut deps = setup();

        let error = execute(
            deps.as_mut(),
            mock_env(),
            mock_info(STRANGER, &[]),
            ExecuteMsg::Register {
                label: "alice".to_string(),
                owner_pubkey: Binary::from(vec![0x04; 65]),
            },
        )
        .unwrap_err();

        assert!(matches!(error, ContractError::BadPubkey));
    }

    /// Each case starts from its own registry.
    ///
    /// The nonce is spent before the action runs, and on chain a failing action
    /// reverts that write along with everything else. A unit test has no
    /// transaction to revert, so a shared fixture would carry a consumed nonce
    /// into the next case and end up testing the harness rather than the
    /// contract.
    #[test]
    fn profile_limits_are_enforced_here_and_not_only_in_the_form() {
        let attempt = |profile: Action| {
            let mut deps = setup();
            let owner = key(22);
            register(deps.as_mut(), "alice", &owner);
            authorise(deps.as_mut(), &mock_env(), &owner, "alice", 0, profile)
        };

        let named = |name: String| Action::SetProfile {
            name,
            bio: String::new(),
            avatar: String::new(),
            links: vec![],
        };

        assert!(matches!(
            attempt(named("a".repeat(MAX_NAME + 1))).unwrap_err(),
            ContractError::TooLong { field: "name", .. }
        ));

        // Characters, not bytes: thirty-two accented letters are thirty-two
        // letters, not sixty-four.
        attempt(named("\u{e1}".repeat(MAX_NAME))).unwrap();

        assert!(matches!(
            attempt(Action::SetProfile {
                name: String::new(),
                bio: "b".repeat(MAX_BIO + 1),
                avatar: String::new(),
                links: vec![],
            })
            .unwrap_err(),
            ContractError::TooLong { field: "bio", .. }
        ));

        assert!(matches!(
            attempt(Action::SetProfile {
                name: String::new(),
                bio: String::new(),
                avatar: "data:image/png;base64,AAAA".to_string(),
                links: vec![],
            })
            .unwrap_err(),
            ContractError::AvatarNotWebp
        ));

        assert!(matches!(
            attempt(Action::SetProfile {
                name: String::new(),
                bio: String::new(),
                avatar: format!("{}{}", AVATAR_PREFIX, "A".repeat(MAX_AVATAR)),
                links: vec![],
            })
            .unwrap_err(),
            ContractError::AvatarTooLarge { .. }
        ));

        assert!(matches!(
            attempt(Action::SetProfile {
                name: String::new(),
                bio: String::new(),
                avatar: String::new(),
                links: (0..MAX_LINKS + 1)
                    .map(|index| Link {
                        kind: format!("k{index}"),
                        value: "value".to_string(),
                    })
                    .collect(),
            })
            .unwrap_err(),
            ContractError::TooManyLinks { .. }
        ));
    }

    #[test]
    fn empty_link_rows_are_dropped_and_the_rest_normalised() {
        let mut deps = setup();
        let owner = key(23);
        register(deps.as_mut(), "alice", &owner);

        authorise(
            deps.as_mut(),
            &mock_env(),
            &owner,
            "alice",
            0,
            Action::SetProfile {
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

        let response: ProfileResponse = from_binary(
            &query(
                deps.as_ref(),
                mock_env(),
                QueryMsg::Profile {
                    label: "alice".to_string(),
                },
            )
            .unwrap(),
        )
        .unwrap();

        let links = response.profile.unwrap().links;
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].kind, "x");
        assert_eq!(links[0].value, "alice");
    }
}

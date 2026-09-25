use cosmwasm_std::{Env, StdResult, Storage, Uint128};
use cosmwasm_storage::{singleton, singleton_read};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::state::{balance_key, balances, Slot, KEY_BUFFER};

/// A delayed write buffer, so a tip does not write the balance of the name it
/// was sent to.
///
/// The attack it answers is not about reading state. Contract storage is
/// encrypted, but an adversarial node operator can still see *which* encrypted
/// keys a transaction touches. Credit `alice` directly and the tip writes
/// alice's balance key; the withdrawal later reads the same key; joining the
/// two links the tipper to the address that claimed. Everything else in this
/// contract would be doing its job and the privacy would still be gone.
///
/// So a credit goes into one of a fixed number of slots chosen at random, and
/// pays for its slot by settling whichever *unrelated* credit was already
/// sitting there. Every tip therefore writes exactly one balance key belonging
/// to somebody else, picked without reference to its own recipient, and the
/// name it was actually for is written at some unpredictable later moment by a
/// transaction that has nothing to do with the tipper.
///
/// The idea and the sizing are from SNIP-20's delayed write buffer, which
/// scrtlabs shipped across 42 mainnet tokens for exactly this reason
/// (`dwb.rs` in scrtlabs/snip20-reference-impl, Apache-2.0; the analysis is in
/// arXiv 2607.04032, which puts the cost at roughly +26% gas and reports that
/// at k=64 an attacker needs close to 300 further transactions to reach 99%
/// confidence that a given balance was touched). This is a much smaller thing
/// than theirs: credits only, no transfer graph, no bucketed trie, because a
/// registry has no `transfer_from` and nobody spends from a name but its owner.
pub const SLOTS: usize = 64;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct Buffer {
    pub slots: Vec<Slot>,
    /// Counts credits, and is mixed into the slot choice.
    ///
    /// Without it two tips in the same block would draw the same slot, since
    /// `env.block.random` is per-block: the second would evict the first and
    /// the pattern would be legible. The counter is deliberately not derived
    /// from the credit being written — a slot chosen from the label or the
    /// amount would be a function of the thing being hidden.
    pub writes: u64,
}

impl Default for Buffer {
    fn default() -> Self {
        Buffer {
            slots: vec![Slot::default(); SLOTS],
            writes: 0,
        }
    }
}

pub fn load(storage: &dyn Storage) -> StdResult<Buffer> {
    Ok(singleton_read::<Buffer>(storage, KEY_BUFFER)
        .may_load()?
        .unwrap_or_default())
}

fn save(storage: &mut dyn Storage, buffer: &Buffer) -> StdResult<()> {
    singleton::<Buffer>(storage, KEY_BUFFER).save(buffer)
}

/// Which slot this credit lands in.
///
/// `env.block.random` is the enclave's own randomness and is the right source
/// when it is there. When it is not — an older node, or a unit test — the
/// height and time still vary per block, which is weaker but never worse than
/// a fixed slot. The fallback is not a security claim; it is what keeps the
/// contract from having no buffer at all on a chain that does not offer one.
fn choose(env: &Env, writes: u64) -> usize {
    let mut hasher = Sha256::new();
    match &env.block.random {
        Some(random) => hasher.update(random.as_slice()),
        None => {
            hasher.update(env.block.height.to_be_bytes());
            hasher.update(env.block.time.seconds().to_be_bytes());
        }
    }
    hasher.update(writes.to_be_bytes());
    let digest = hasher.finalize();

    let mut picked = [0u8; 8];
    picked.copy_from_slice(&digest[..8]);
    (u64::from_be_bytes(picked) % SLOTS as u64) as usize
}

/// Add `amount` to a name's pending credit, settling one unrelated slot.
pub fn credit(
    storage: &mut dyn Storage,
    env: &Env,
    label: &str,
    token: u8,
    amount: Uint128,
) -> StdResult<()> {
    let mut buffer = load(storage)?;
    let index = choose(env, buffer.writes);

    // Whatever was here belongs to somebody else. Paying it out of the buffer
    // now is what makes this transaction write a balance key unrelated to its
    // own recipient.
    let evicted = std::mem::take(&mut buffer.slots[index]);
    if !evicted.is_free() {
        add(storage, &evicted.label, evicted.token, evicted.amount)?;
    }

    buffer.slots[index] = Slot {
        label: label.to_string(),
        token,
        amount,
    };
    buffer.writes = buffer.writes.wrapping_add(1);

    save(storage, &buffer)
}

/// Flush everything buffered for one name into its balances.
///
/// Called before a withdrawal, from the owner's own transaction — the one
/// place where writing this name's keys reveals nothing that the signer did
/// not already know.
pub fn settle(storage: &mut dyn Storage, label: &str) -> StdResult<()> {
    let mut buffer = load(storage)?;
    let mut pending: Vec<Slot> = Vec::new();

    for slot in buffer.slots.iter_mut() {
        if !slot.is_free() && slot.label == label {
            pending.push(std::mem::take(slot));
        }
    }

    if pending.is_empty() {
        return Ok(());
    }

    for slot in pending {
        add(storage, &slot.label, slot.token, slot.amount)?;
    }

    save(storage, &buffer)
}

/// What is sitting in the buffer for a name, without settling it.
pub fn pending(buffer: &Buffer, label: &str, token: u8) -> Uint128 {
    buffer
        .slots
        .iter()
        .filter(|slot| !slot.is_free() && slot.label == label && slot.token == token)
        .fold(Uint128::zero(), |total, slot| total + slot.amount)
}

fn add(storage: &mut dyn Storage, label: &str, token: u8, amount: Uint128) -> StdResult<()> {
    let key = balance_key(label, token);
    let current = balances(storage).may_load(&key)?.unwrap_or_default();
    balances(storage).save(&key, &(current + amount))
}

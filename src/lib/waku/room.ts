/**
 * Where a multisig's proposals travel, and the key they travel under.
 *
 * Both are derived from the one random secret already in the account's
 * configuration — the thing members exchange once, carefully, when they set
 * the account up. Nothing else is needed to join the conversation, and nothing
 * here touches the network: this file is arithmetic, so it can be checked
 * offline and so the transport that uses it can be loaded only when it is
 * actually wanted.
 *
 * ## Why the topic comes from the secret and not from the address
 *
 * A hashed address would be the obvious choice and it would be a mistake.
 * Anyone who knows the account — and an account is public the moment it holds
 * anything — could compute the same hash, find the group's topic and watch its
 * traffic: how many proposals, how often, when the group is busy, when it is
 * asleep. None of that is protected by encrypting the payload.
 *
 * Derived from a secret only members hold, an observer cannot even locate the
 * conversation. The application prefix stays fixed so that autosharding puts
 * every group on the same shard: a topic derived per group would otherwise
 * spread groups across shards and make each one's traffic stand out by where
 * it lives.
 *
 * The secret is a transport key. It is not a signing key, it grants no
 * authority over the account, and losing it costs a group its private channel
 * and nothing else — every bundle is verified on arrival regardless of how it
 * arrived.
 */

import { sha256 } from '@cosmjs/crypto'
import { fromHex, toHex, toUtf8 } from '@cosmjs/encoding'

export interface Room {
  /** The Waku content topic, in the `/app/version/name/encoding` shape. */
  contentTopic: string
  /** 32 bytes. The payload key, distinct from the topic by construction. */
  symKey: Uint8Array
}

/** Fixed, so every group shares a shard rather than each advertising its own. */
const APPLICATION = 'secret-dashboard'
const VERSION = '1'

/**
 * Two labels so one secret yields two independent values.
 *
 * Without them the topic would be a function of the key — publishing the topic
 * would be publishing a hash of the key, which is not a break but is an
 * invitation to one.
 */
const KEY_LABEL = 'secret-dashboard:multisig:v1:key'
const TOPIC_LABEL = 'secret-dashboard:multisig:v1:topic'

function derive(secret: Uint8Array, label: string): Uint8Array {
  return sha256(Uint8Array.from([...secret, ...toUtf8(label)]))
}

export function deriveRoom(roomSecretHex: string): Room {
  if (!/^[0-9a-f]{64}$/i.test(roomSecretHex)) {
    throw new Error('A multisig’s shared transport key is 32 bytes of hex.')
  }

  const secret = fromHex(roomSecretHex.toLowerCase())

  return {
    // Eight bytes is plenty to keep two groups apart, and short enough that a
    // topic stays readable in a log.
    contentTopic: `/${APPLICATION}/${VERSION}/ms-${toHex(derive(secret, TOPIC_LABEL)).slice(0, 16)}/proto`,
    symKey: derive(secret, KEY_LABEL)
  }
}

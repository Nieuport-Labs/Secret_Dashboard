import type { Msg } from 'secretjs'

/**
 * Turning hand-written JSON into the protobuf messages a proposal executes.
 *
 * A governance proposal on gov v1 is a list of `Any`-encoded messages the
 * chain runs against its own authority if the vote passes. There are dozens of
 * them across Cosmos and Secret's own modules, so this app does not model them
 * one by one: it takes the same JSON the chain prints back on an existing
 * proposal and encodes it with secretjs's own protobuf definitions.
 *
 * `MsgRegistry` is what makes that possible — secretjs keeps a map of every
 * type URL it knows to the generated codec for it, which is the only place a
 * type URL can be turned into bytes the chain will accept.
 */

/** A message that was written out, and what the chain will actually receive. */
export interface EncodedProposalMessage {
  typeUrl: string
  /** Handed to `MsgSubmitProposal`, which encodes it into an `Any`. */
  msg: Msg
  /**
   * The bytes decoded back into JSON.
   *
   * Shown to the author before they sign, and not decoration: protobuf has no
   * notion of an unexpected field, so a misspelled key is dropped in silence
   * and a proposal that reads right can execute something else. The round trip
   * is the only honest account of what was understood.
   */
  decoded: Record<string, unknown>
}

export class ProposalMessageError extends Error {
  readonly name = 'ProposalMessageError'
}

/**
 * Compute messages carry a payload encrypted to the chain's consensus key, and
 * that encryption happens inside secretjs's own `MsgExecuteContract` — not in
 * the generic codec used here. Encoding one from raw JSON would put the plain
 * text on chain in a field the contract cannot read, so it is refused rather
 * than mangled. A contract migration still goes through `secretcli`.
 */
const NEEDS_ENCRYPTION = '/secret.compute.'

/** The shape of a ts-proto codec, which `MsgRegistry` types only as a decoder. */
interface Codec {
  fromJSON(value: unknown): unknown
  toJSON(value: unknown): unknown
  encode(value: unknown): { finish(): Uint8Array }
  decode(input: Uint8Array): unknown
}

/**
 * Parse and encode the messages a proposal should execute.
 *
 * Accepts either a bare message object or an array of them, and both spellings
 * of the type URL: `@type` as the chain prints it, and `type_url` as protobuf
 * names it. An empty array is legitimate — that is a text proposal.
 *
 * Throws `ProposalMessageError` with something a person can act on; every
 * failure here is the author's JSON rather than a fault in the app.
 */
export async function encodeProposalMessages(source: string): Promise<EncodedProposalMessage[]> {
  const text = source.trim()
  if (!text) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new ProposalMessageError(
      `That is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
    )
  }

  const list = Array.isArray(parsed) ? parsed : [parsed]
  if (list.length === 0) return []

  const { MsgRegistry } = await import('secretjs')

  return list.map((entry, index) => {
    const where = list.length > 1 ? ` (message ${index + 1})` : ''

    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new ProposalMessageError(`Each message must be a JSON object${where}.`)
    }

    const fields = { ...(entry as Record<string, unknown>) }
    const typeUrl = String(fields['@type'] ?? fields.type_url ?? '')
    delete fields['@type']
    delete fields.type_url

    if (!typeUrl) {
      throw new ProposalMessageError(
        `A message needs an "@type", such as "/cosmos.bank.v1beta1.MsgSend"${where}.`
      )
    }

    if (typeUrl.startsWith(NEEDS_ENCRYPTION)) {
      throw new ProposalMessageError(
        `${typeUrl} carries an encrypted payload and cannot be written by hand here${where}. ` +
          'Submit that proposal with secretcli.'
      )
    }

    const codec = MsgRegistry.get(typeUrl) as unknown as Codec | undefined
    if (!codec) {
      throw new ProposalMessageError(`Unknown message type ${typeUrl}${where}.`)
    }

    let value: unknown
    let bytes: Uint8Array
    let decoded: Record<string, unknown>
    try {
      value = codec.fromJSON(fields)
      bytes = codec.encode(value).finish()
      decoded = codec.toJSON(codec.decode(bytes)) as Record<string, unknown>
    } catch (error) {
      throw new ProposalMessageError(
        `${typeUrl} could not be encoded${where}: ` + (error instanceof Error ? error.message : String(error))
      )
    }

    return {
      typeUrl,
      decoded,
      msg: {
        toProto: async () => ({
          type_url: typeUrl,
          value,
          encode: () => bytes
        }),
        // Only ever sent with the direct signer — as is every other message in
        // this app, and as `MsgSubmitProposal` itself demands.
        toAmino: async () => {
          throw new ProposalMessageError(`${typeUrl} cannot be signed with an amino wallet.`)
        }
      }
    }
  })
}

/**
 * The authority nearly every proposal message has to name: the gov module's
 * own account, which is the only signer the chain accepts for a message it
 * executes on a proposal's behalf.
 *
 * Hard-coded rather than derived: it is a constant of the chain —
 * `authtypes.NewModuleAddress("gov")` in Secret's bech32 prefix — and it is
 * the address every message on secret-4's own proposals names today, which is
 * where this one was read from. Offered to the author as a hint; nothing here
 * depends on their taking it.
 */
export const GOV_AUTHORITY = 'secret10d07y265gmmuvt4z0w9aw880jnsr700jc88vt0'

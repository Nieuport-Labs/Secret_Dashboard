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
 * Codecs the chain serves that secretjs's registry does not list.
 *
 * `MsgRegistry` is assembled by hand in secretjs from six messages of
 * `cosmos/gov/v1/tx`, and `MsgUpdateParams` — the only way to change a
 * governance parameter on an SDK 0.50 chain — is not among them. The generated
 * codec for it ships in the same package and works; only the registry entry is
 * missing, so this supplements the lookup rather than reimplementing anything.
 * The deep import is safe: secretjs declares no `exports` map, so its `dist`
 * tree is importable by both Vite and Node.
 *
 * Every other module's `MsgUpdateParams` is missing from that registry too.
 * They are a line each when one is actually needed; guessing at which ones will
 * be would be inventing work.
 */
async function extraCodecs(): Promise<Map<string, Codec>> {
  // The `.js` is not decoration: Node's ESM resolver refuses the
  // extensionless path, and Vite resolves either.
  const gov = await import('secretjs/dist/protobuf/cosmos/gov/v1/tx.js')
  return new Map<string, Codec>([['/cosmos.gov.v1.MsgUpdateParams', gov.MsgUpdateParams as unknown as Codec]])
}

/**
 * `"604800s"` → `{ seconds: "604800", nanos: 0 }`, everywhere it appears.
 *
 * The chain writes a protobuf `Duration` as the string the JSON mapping calls
 * for, and it is how the chain prints its own parameters back — but secretjs's
 * generated `Duration.fromJSON` reads only the `{ seconds, nanos }` form and
 * answers a string with a *zero duration*. Left alone, a gov parameter change
 * pasted from the chain's own output encodes a voting period of nothing.
 *
 * Recognised by shape rather than by field name, because nothing here knows the
 * schema of the message being written. A string field whose value happens to
 * read like a duration would be turned into an object it cannot hold, so the
 * caller checks for that and falls back to the untouched JSON.
 */
const DURATION = /^-?\d+(\.\d+)?s$/

function withDurations(value: unknown): unknown {
  if (typeof value === 'string' && DURATION.test(value)) {
    const seconds = value.slice(0, -1)
    const [whole, fraction = ''] = seconds.split('.')
    return {
      seconds: whole,
      // Nanoseconds are whatever the fraction carried, padded out to nine
      // digits — "1.5s" is half a second, not five.
      nanos: fraction ? Number(fraction.padEnd(9, '0').slice(0, 9)) : 0
    }
  }
  if (Array.isArray(value)) return value.map(withDurations)
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, withDurations(entry)])
    )
  }
  return value
}

/** What a ts-proto codec prints when an object was handed to a string field. */
const MANGLED = '[object Object]'

function mangled(value: unknown): boolean {
  if (typeof value === 'string') return value.includes(MANGLED)
  if (Array.isArray(value)) return value.some(mangled)
  if (typeof value === 'object' && value !== null) {
    return Object.values(value as Record<string, unknown>).some(mangled)
  }
  return false
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
  const extra = await extraCodecs()

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

    const codec = (MsgRegistry.get(typeUrl) as unknown as Codec | undefined) ?? extra.get(typeUrl)
    if (!codec) {
      throw new ProposalMessageError(`Unknown message type ${typeUrl}${where}.`)
    }

    let value: unknown
    let bytes: Uint8Array
    let decoded: Record<string, unknown>
    try {
      const encode = (from: unknown) => {
        const built = codec.fromJSON(from)
        const written = codec.encode(built).finish()
        return { built, written, read: codec.toJSON(codec.decode(written)) as Record<string, unknown> }
      }

      let attempt = encode(withDurations(fields))
      /*
       * A string field that merely looked like a duration was handed an object
       * and printed back as "[object Object]". The conversion was wrong for
       * this message, so it is taken back — the durations in it, if any, then
       * show as zero in the round trip the author is looking at.
       */
      if (mangled(attempt.read)) attempt = encode(fields)

      value = attempt.built
      bytes = attempt.written
      decoded = attempt.read
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

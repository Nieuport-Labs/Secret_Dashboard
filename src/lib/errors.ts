/**
 * Turning whatever was thrown into something a person can read.
 *
 * `error instanceof Error ? error.message : String(error)` is the reflex, and
 * on this stack it is wrong in the most common case. secretjs's gRPC-gateway
 * layer does not throw an `Error` — it throws the node's parsed JSON body:
 *
 *   { code: 5, message: "rpc error: code = NotFound desc = proposal 99999
 *     doesn't exist: key not found", details: [] }
 *
 * which is not an `Error`, so the reflex falls through to `String(error)` and
 * puts `[object Object]` on screen in place of a message that said exactly what
 * went wrong.
 */

/** The gRPC-gateway error body, which is what a failed LCD query throws. */
interface GatewayError {
  code?: number
  message?: string
}

function asGatewayError(error: unknown): GatewayError | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const candidate = error as GatewayError
  return typeof candidate.message === 'string' ? candidate : undefined
}

/**
 * A readable message from anything throwable.
 *
 * The node's own prefix is stripped: `rpc error: code = NotFound desc = ` is
 * transport bookkeeping, and the sentence after it is the part worth showing.
 */
export function errorMessage(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : (asGatewayError(error)?.message ?? String(error))

  return raw.replace(/^rpc error: code = \w+ desc = /, '').trim() || 'Something went wrong.'
}

/**
 * Whether this is the chain saying "no such thing", rather than a failure to
 * ask it.
 *
 * The distinction matters: one is an empty state, the other is an error worth
 * retrying. gRPC status 5 is `NotFound`; the text check covers nodes that
 * answer with the message but without the code.
 */
export function isNotFound(error: unknown): boolean {
  if (asGatewayError(error)?.code === 5) return true
  return /not found|doesn't exist|does not exist/i.test(errorMessage(error))
}

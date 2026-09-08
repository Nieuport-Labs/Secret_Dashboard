/**
 * Endpoint resolution.
 *
 * This module exists because a dead public node rarely fails cleanly. It
 * answers at the HTTP level with an HTML error page, which reaches the user as
 * `Unexpected token '<'` thrown from somewhere deep inside secretjs — a message
 * that says nothing about the actual problem. Worse, a node can be perfectly
 * healthy and serving a different chain: one endpoint listed in the cosmos
 * chain-registry under Secret answers every query for `axone-1`.
 *
 * So an endpoint is accepted only when it returns JSON *and* names the chain we
 * asked for. See docs/chain-facts.md.
 */

import { CHAIN_ID, DEFAULT_LCD_URLS, DEFAULT_RPC_URLS } from '@/chains/secret4'
import { errorMessage } from '@/lib/errors'

const PROBE_TIMEOUT_MS = 8000

/** A resolved endpoint is cached for the page load, not across reloads. */
const resolved = new Map<string, Promise<string>>()

/** Split a settings value. Endpoint settings accept a comma-separated list. */
export function parseEndpointList(value: string | undefined | null): string[] {
  return (value ?? '')
    .split(',')
    .map((url) => url.trim().replace(/\/+$/, ''))
    .filter(Boolean)
}

export type ProbeResult = { url: string; ok: true } | { url: string; ok: false; reason: string }

async function fetchJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { headers: { Accept: 'application/json' }, signal })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)

  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('json')) {
    // The HTML-error-page case. Naming it here is the whole point of this module.
    throw new Error(`responded with ${contentType || 'no content type'}, not JSON`)
  }

  return response.json()
}

export async function probeLcd(url: string): Promise<ProbeResult> {
  try {
    const body = (await fetchJson(
      `${url.replace(/\/+$/, '')}/cosmos/base/tendermint/v1beta1/node_info`,
      AbortSignal.timeout(PROBE_TIMEOUT_MS)
    )) as { default_node_info?: { network?: string } }

    const network = body.default_node_info?.network
    if (network !== CHAIN_ID) return { url, ok: false, reason: `serves ${network ?? 'an unknown chain'}` }
    return { url, ok: true }
  } catch (error) {
    return { url, ok: false, reason: describeNetworkError(error) }
  }
}

export async function probeRpc(url: string): Promise<ProbeResult> {
  try {
    const body = (await fetchJson(
      `${url.replace(/\/+$/, '')}/status`,
      AbortSignal.timeout(PROBE_TIMEOUT_MS)
    )) as { result?: { node_info?: { network?: string } } }

    const network = body.result?.node_info?.network
    if (network !== CHAIN_ID) return { url, ok: false, reason: `serves ${network ?? 'an unknown chain'}` }
    return { url, ok: true }
  } catch (error) {
    return { url, ok: false, reason: describeNetworkError(error) }
  }
}

async function resolveFirstWorking(
  candidates: string[],
  probe: (url: string) => Promise<ProbeResult>,
  kind: string
): Promise<string> {
  const failures: string[] = []

  for (const url of candidates) {
    const result = await probe(url)
    if (result.ok) return result.url
    failures.push(`${url} (${result.reason})`)
  }

  throw new Error(
    `No ${kind} endpoint could serve ${CHAIN_ID}. Tried:\n${failures.join('\n')}\n\n` +
      `You can set your own endpoint in Settings.`
  )
}

/**
 * @param overrides comma-separated user setting; takes precedence over defaults.
 */
export function resolveLcdUrl(overrides?: string): Promise<string> {
  const candidates = parseEndpointList(overrides)
  const list = candidates.length > 0 ? candidates : DEFAULT_LCD_URLS
  const key = `lcd:${list.join(',')}`

  const cached = resolved.get(key)
  if (cached) return cached

  const pending = resolveFirstWorking(list, probeLcd, 'LCD').catch((error: unknown) => {
    // Never cache a failure; the next attempt should try again.
    resolved.delete(key)
    throw error
  })

  resolved.set(key, pending)
  return pending
}

export function resolveRpcUrl(overrides?: string): Promise<string> {
  const candidates = parseEndpointList(overrides)
  const list = candidates.length > 0 ? candidates : DEFAULT_RPC_URLS
  const key = `rpc:${list.join(',')}`

  const cached = resolved.get(key)
  if (cached) return cached

  const pending = resolveFirstWorking(list, probeRpc, 'RPC').catch((error: unknown) => {
    resolved.delete(key)
    throw error
  })

  resolved.set(key, pending)
  return pending
}

/** Forget resolved endpoints, e.g. after the user changes them in Settings. */
export function forgetResolvedEndpoints(): void {
  resolved.clear()
}

/** The Tendermint WebSocket for an RPC URL, which is where SNIP-52 listens. */
export function websocketUrlFor(rpcUrl: string): string {
  return `${rpcUrl.replace(/^http/, 'ws').replace(/\/+$/, '')}/websocket`
}

/**
 * Turn a caught error into something worth showing a person.
 *
 * Call this before rendering any caught network error. The raw ones name
 * parsers and internal frames rather than the thing that went wrong.
 */
export function describeNetworkError(error: unknown): string {
  // Through the helper, so a secretjs failure is matched on its actual text
  // rather than on "[object Object]" — which fell past every branch below and
  // out through the generic one, defeating the point of this function.
  const message = errorMessage(error)

  if (/Unexpected token '<'|is not valid JSON|not JSON/i.test(message)) {
    return 'The node returned a web page instead of data — it is probably down or misconfigured.'
  }
  if (/timeout|aborted|AbortError/i.test(message)) {
    return 'The node did not answer in time.'
  }
  if (/Failed to fetch|NetworkError|ENOTFOUND|ECONNREFUSED|ECONNRESET/i.test(message)) {
    return 'The node could not be reached.'
  }
  if (/certificate/i.test(message)) {
    return "The node's TLS certificate is not valid."
  }
  return message
}

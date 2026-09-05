import { CHAIN_ID } from '@/chains/secret4'
import { SSCRT_ADDRESS } from '@/tokens/registry'

/**
 * Which tokens to read on load, per account.
 *
 * Reading all 96 registry contracts every time would mean roughly two hundred
 * requests against infrastructure that has two working providers. So the
 * dashboard reads a small set by default and remembers any token that has ever
 * shown a balance for this account. A full sweep stays available, but it is
 * something the user asks for rather than something that happens on every load.
 *
 * This is a cache of what to look at, never of balances themselves.
 */

const KEY_PREFIX = 'secret-dashboard:watchlist'

/** Always read, whatever the account has held. sSCRT is the chain's default token. */
const ALWAYS: string[] = [SSCRT_ADDRESS]

function key(address: string): string {
  return `${KEY_PREFIX}:${CHAIN_ID}:${address}`
}

export function loadWatchlist(address: string): string[] {
  try {
    const raw = localStorage.getItem(key(address))
    const stored = raw ? (JSON.parse(raw) as unknown) : []
    const list = Array.isArray(stored) ? stored.filter((v): v is string => typeof v === 'string') : []
    return [...new Set([...ALWAYS, ...list])]
  } catch {
    return [...ALWAYS]
  }
}

/** Remember a token that showed a balance, so it is read on the next visit. */
export function rememberTokens(address: string, contractAddresses: string[]): void {
  if (contractAddresses.length === 0) return
  try {
    const merged = [...new Set([...loadWatchlist(address), ...contractAddresses])]
    localStorage.setItem(key(address), JSON.stringify(merged))
  } catch {
    // Only costs a re-scan next time.
  }
}

export function clearWatchlist(address: string): void {
  try {
    localStorage.removeItem(key(address))
  } catch {
    /* nothing to undo */
  }
}

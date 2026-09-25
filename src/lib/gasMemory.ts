/**
 * Gas limits from what the same transaction actually used before.
 *
 * On Secret the whole gas limit is charged, not the gas used, and a contract
 * execute cannot be simulated beforehand (secretjs refuses: the message is
 * encrypted). So a limit is a guess, and a hand-sized one has to be generous
 * enough for the worst case. Once a transaction of the same shape has gone
 * through, its `gas_used` is a much better guess: the next limit is that, plus
 * a small margin.
 *
 * Kept in this browser only. A shape is whatever the caller names it — for a
 * gas credit purchase, the token swapped and the pools it goes through, since
 * each token contract and each pool costs its own.
 */

const STORAGE_KEY = 'secret-dashboard:gas-used:v1'
/** Above the most a shape has used. Executions of the same shape vary by a few percent. */
const MARGIN = 1.12
/** Samples kept per shape; the limit follows the largest. */
const KEEP = 5
const MAX_SHAPES = 200

type Memory = Record<string, number[]>

function load(): Memory {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Memory) : {}
  } catch {
    return {}
  }
}

/** The limit for `shape`: learned when it has been seen, else `fallback`. */
export function gasLimitFor(shape: string, fallback: number): number {
  const seen = load()[shape]
  if (!seen || seen.length === 0) return fallback
  return Math.ceil(Math.max(...seen) * MARGIN)
}

/** Remember what a transaction that went through actually used. */
export function rememberGasUsed(shape: string, gasUsed: number): void {
  if (!Number.isFinite(gasUsed) || gasUsed <= 0) return
  try {
    const memory = load()
    memory[shape] = [...(memory[shape] ?? []), Math.ceil(gasUsed)].slice(-KEEP)
    const shapes = Object.keys(memory)
    // Oldest insertions first; enough to keep the store bounded.
    for (const stale of shapes.slice(0, Math.max(0, shapes.length - MAX_SHAPES))) delete memory[stale]
    localStorage.setItem(STORAGE_KEY, JSON.stringify(memory))
  } catch {
    // Only a better guess next time.
  }
}

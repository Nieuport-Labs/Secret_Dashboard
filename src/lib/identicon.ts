/**
 * A deterministic hue from a string, for a colour-only fallback avatar.
 *
 * Not an identity claim — just a way to tell two different somethings apart at
 * a glance (an account, a validator) without a picture for either.
 */
export function hueFor(seed: string): number {
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) % 360
  return hash
}

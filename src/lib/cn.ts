/**
 * Join class names, dropping anything falsy.
 *
 * Deliberately not `clsx` + `tailwind-merge`: this app's components own their
 * class lists rather than accepting arbitrary overrides, so there is nothing to
 * de-conflict, and two dependencies would earn their bytes only if that changed.
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

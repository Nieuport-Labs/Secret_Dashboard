/**
 * "in 14 days" beats a date: the wait is the thing being asked about.
 *
 * Its own module rather than living beside the components that use it, so that
 * a file exporting React components exports only React components — see the
 * `react-refresh/only-export-components` rule.
 */
export function waitLabel(at?: Date): string {
  // No date means the request exists but has not been sent — Shade holds one
  // until its next batch goes out, and nothing is counting down yet.
  if (!at) return 'Not sent yet'

  const remaining = at.getTime() - Date.now()
  if (remaining <= 0) return 'Releasing'

  const days = Math.ceil(remaining / 86_400_000)
  if (days > 1) return `in ${days} days`

  const hours = Math.ceil(remaining / 3_600_000)
  return hours > 1 ? `in ${hours} hours` : 'within the hour'
}

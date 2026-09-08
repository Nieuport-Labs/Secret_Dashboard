import type { VoteOption } from '@/lib/governance'

/**
 * One palette for every way this app draws a tally — the bar, the ring and the
 * breakdown all read from here, so a colour can never come to mean one thing in
 * a list and another on the page it links to.
 *
 * Yes and no take the app's own positive and negative. Abstain is deliberately
 * neutral grey. Veto gets a violet of its own rather than a second red: "no"
 * and "no with veto" have genuinely different consequences — a third of the
 * vote in veto rejects a proposal outright, whatever the majority said — and
 * two shades of the same colour is how someone reads one as the other.
 */
export const VOTE_COLORS: Record<VoteOption, string> = {
  YES: 'var(--color-positive)',
  ABSTAIN: '#8b93a3',
  NO: 'var(--color-negative)',
  NO_WITH_VETO: '#a855f7'
}

/** Yes first, then the ways of not saying yes, ending with the strongest no. */
export const VOTE_ORDER = ['YES', 'ABSTAIN', 'NO', 'NO_WITH_VETO'] as const

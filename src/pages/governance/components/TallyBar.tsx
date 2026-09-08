import { VOTE_LABELS, type Outcome, type Tally, type VoteOption } from '@/lib/governance'
import { VOTE_COLORS as COLORS, VOTE_ORDER } from '@/pages/governance/components/voteColors'

const ORDER: readonly VoteOption[] = VOTE_ORDER

interface Props {
  tally: Tally
  outcome?: Outcome
  /**
   * This vote is already closed.
   *
   * Turnout is the one figure here that is not self-contained: it divides the
   * votes cast by the stake bonded *now*, because the chain does not keep what
   * was bonded then. For an open proposal that is exact; for one from two years
   * ago it is an estimate, and it gets shown as one rather than as a fact.
   */
  historic?: boolean
  /**
   * Turnout only, without the thresholds it is measured against.
   *
   * For a card in a grid. Spelling out both bars and what each needs is four
   * figures per card, and two dozen cards of that is a wall of numbers that
   * buries the one thing the card is for — whether this proposal is worth
   * opening. The full reading lives on the proposal's own page.
   */
  compact?: boolean
}

/**
 * The vote as one bar.
 *
 * Segments are proportional to voting power cast, not to turnout: the bar
 * answers "how did the votes split", and quorum — how many voted at all — is a
 * separate figure below it, because a bar that folded both together would show
 * a landslide and a rounding error as the same picture.
 */
export default function TallyBar({ tally, outcome, historic = false, compact = false }: Props) {
  const amounts: Record<VoteOption, bigint> = {
    YES: tally.yes,
    ABSTAIN: tally.abstain,
    NO: tally.no,
    NO_WITH_VETO: tally.veto
  }

  const cast = tally.yes + tally.abstain + tally.no + tally.veto
  const share = (value: bigint) => (cast <= 0n ? 0 : Number((value * 1_000_000n) / cast) / 10_000)

  if (cast <= 0n) {
    return (
      <p className="text-label text-text-faint">
        {outcome ? 'No votes cast yet' : 'No tally available'}
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div
        className="flex h-2 w-full overflow-hidden rounded-pill bg-surface"
        role="img"
        aria-label={ORDER.filter((option) => amounts[option] > 0n)
          .map((option) => `${VOTE_LABELS[option]} ${share(amounts[option]).toFixed(1)}%`)
          .join(', ')}
      >
        {ORDER.map((option) =>
          amounts[option] > 0n ? (
            <div
              key={option}
              style={{ flexGrow: Number(share(amounts[option])), backgroundColor: COLORS[option] }}
              className="h-full"
            />
          ) : null
        )}
      </div>

      {/*
        Turnout, and — off a card — what it and the yes share each had to beat.
        Either figure alone misleads: a proposal can be overwhelmingly in favour
        and still fail for want of turnout, which is the case a bar cannot show
        on its own.
      */}
      {outcome ? (
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-label tabular-nums">
          <span
            className="text-text-muted"
            title={
              historic
                ? 'Measured against the stake bonded today — the chain does not record what was bonded at the time'
                : undefined
            }
          >
            Turnout{' '}
            <span className={outcome.quorumMet ? 'text-positive' : 'text-text'}>
              {historic ? '~' : ''}
              {(outcome.turnout * 100).toFixed(1)}%
            </span>
            {compact ? null : (
              <span className="text-text-faint"> of {(outcome.quorum * 100).toFixed(1)}% needed</span>
            )}
          </span>

          {compact ? null : (
            <span className="text-text-muted">
              Yes{' '}
              <span className={outcome.yesRatio > outcome.threshold ? 'text-positive' : 'text-text'}>
                {(outcome.yesRatio * 100).toFixed(1)}%
              </span>
              <span className="text-text-faint"> of {(outcome.threshold * 100).toFixed(1)}% needed</span>
            </span>
          )}

          {/* A veto is worth the words even on a card: a third of the vote in
              veto rejects a proposal outright, whatever the majority said. */}
          {outcome.vetoed ? (
            <span className="text-negative">Vetoed — {(outcome.vetoRatio * 100).toFixed(1)}%</span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

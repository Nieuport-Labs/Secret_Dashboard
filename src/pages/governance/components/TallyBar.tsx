import { DISPLAY_DENOM } from '@/chains/secret4'
import { formatDisplayAmount } from '@/lib/format'
import { VOTE_LABELS, type Outcome, type Tally, type VoteOption } from '@/lib/governance'

/**
 * Four colours that survive being next to each other, and that mean something:
 * yes and no take the app's own positive and negative, abstain is deliberately
 * neutral grey, and veto gets a violet of its own rather than a second red —
 * "no" and "no with veto" are different enough that reading one as the other is
 * the whole misunderstanding.
 */
const COLORS: Record<VoteOption, string> = {
  YES: 'var(--color-positive)',
  ABSTAIN: '#8b93a3',
  NO: 'var(--color-negative)',
  NO_WITH_VETO: '#a855f7'
}

const ORDER: VoteOption[] = ['YES', 'ABSTAIN', 'NO', 'NO_WITH_VETO']

interface Props {
  tally: Tally
  outcome?: Outcome
  /** Full breakdown under the bar. Off in a list row, on in the detail view. */
  legend?: boolean
  /**
   * This vote is already closed.
   *
   * Turnout is the one figure here that is not self-contained: it divides the
   * votes cast by the stake bonded *now*, because the chain does not keep what
   * was bonded then. For an open proposal that is exact; for one from two years
   * ago it is an estimate, and it gets shown as one rather than as a fact.
   */
  historic?: boolean
}

/**
 * The vote as one bar, with the legend that makes it readable.
 *
 * Segments are proportional to voting power cast, not to turnout: the bar
 * answers "how did the votes split", and quorum — how many voted at all — is a
 * separate figure, because a bar that folded both together would show a
 * landslide and a rounding error as the same picture.
 */
export default function TallyBar({ tally, outcome, legend = false, historic = false }: Props) {
  const amounts: Record<VoteOption, bigint> = {
    YES: tally.yes,
    ABSTAIN: tally.abstain,
    NO: tally.no,
    NO_WITH_VETO: tally.veto
  }

  const cast = tally.yes + tally.abstain + tally.no + tally.veto
  const share = (value: bigint) =>
    cast <= 0n ? 0 : Number((value * 1_000_000n) / cast) / 10_000

  if (cast <= 0n) {
    return (
      <p className="text-label text-text-faint">
        {outcome ? 'No votes cast yet' : 'No tally available'}
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
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
        Two columns, not four on a wide screen: this legend only ever renders
        inside a 420px dialog, and a `sm:` breakpoint measures the viewport
        rather than the box it is actually in — which put four columns of SCRT
        amounts in a space that fits two, and clipped every one of them.
      */}
      {legend ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
          {ORDER.map((option) => (
            <div key={option} className="flex items-start gap-2">
              <span
                aria-hidden
                className="mt-1 size-2.5 shrink-0 rounded-pill"
                style={{ backgroundColor: COLORS[option] }}
              />
              <span className="min-w-0">
                <span className="block text-label text-text-muted">{VOTE_LABELS[option]}</span>
                <span className="block text-base font-medium tabular-nums">
                  {share(amounts[option]).toFixed(1)}%
                </span>
                <span className="block truncate text-label text-text-faint tabular-nums">
                  {formatDisplayAmount(amounts[option])} {DISPLAY_DENOM}
                </span>
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {/*
        Quorum and threshold, side by side, because either one alone misleads:
        a proposal can be overwhelmingly in favour and still fail for want of
        turnout, and that is the case a bar cannot show on its own.
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
            <span className="text-text-faint"> of {(outcome.quorum * 100).toFixed(1)}% needed</span>
          </span>
          <span className="text-text-muted">
            Yes <span className={outcome.yesRatio > outcome.threshold ? 'text-positive' : 'text-text'}>
              {(outcome.yesRatio * 100).toFixed(1)}%
            </span>
            <span className="text-text-faint"> of {(outcome.threshold * 100).toFixed(1)}% needed</span>
          </span>
          {outcome.vetoed ? (
            <span className="text-negative">Vetoed — {(outcome.vetoRatio * 100).toFixed(1)}%</span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

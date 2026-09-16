import { Check, Clock, PenLine } from 'lucide-react'
import { Link } from 'react-router-dom'

import { cn } from '@/lib/cn'
import { describeMessage } from '@/lib/multisig/describe'
import type { ProposalEntry } from '@/store/multisigProposals'
import { STAGE_LABELS, ageLabel, stageOf, type ProposalStage } from '@/lib/multisig/stage'

/**
 * One proposal in the grid, built like a governance proposal's card.
 *
 * The two are the same kind of object to the person looking at them — a thing
 * somebody put forward, which is either still open to act on or already
 * decided — so they get the same shape: a row of state at the top, a title
 * that clamps to two lines, a line of what it is, and a bar across the bottom
 * saying how far along it is. Anyone who has used the governance screen can
 * read this one without being taught it again.
 *
 * What the bar counts is different, and that is the whole difference. A
 * governance proposal gathers voting power against a quorum; this gathers
 * signatures against a threshold, which is a small number and an exact one, so
 * it is drawn as discrete segments rather than as a proportion. Three of five
 * is three pips, not 60%.
 */
export default function ProposalCard({
  entry,
  threshold,
  signed,
  canSign
}: {
  entry: ProposalEntry
  threshold: number
  /** This wallet is already among the signatures. */
  signed: boolean
  /** This wallet is a member, so an unsigned proposal is waiting for it. */
  canSign: boolean
}) {
  const { proposal } = entry
  const stage = stageOf(entry, threshold)
  const open = stage === 'collecting' || stage === 'ready'
  const waiting = open && canSign && !signed

  const first = proposal.msgs[0] ? describeMessage(proposal.msgs[0]) : undefined
  const extra = proposal.msgs.length - 1

  return (
    <li>
      {/*
        A real link, like the governance card's — a proposal being reviewed by
        several people is a thing they send each other, and a URL is how.
      */}
      <Link
        to={`/multisig/proposals/${proposal.id}`}
        className={cn(
          'card flex h-full flex-col gap-3 p-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
          'transition-colors duration-[var(--duration-short)] ease-[var(--ease-standard)] hover:bg-surface-2'
        )}
        /*
          An accent edge for the ones this member has not signed. In a grid of
          cards the one question worth answering from across the page is which
          of these is waiting for *you* — the same job the accent edge does for
          an open vote on the governance screen.
        */
        style={
          waiting ? { borderColor: 'color-mix(in srgb, var(--color-accent) 50%, transparent)' } : undefined
        }
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <StageBadge stage={stage} />

          {signed ? (
            <span className="inline-flex items-center gap-1 rounded-pill bg-accent-container px-2 py-0.5 text-label font-medium text-accent">
              <Check size={11} aria-hidden />
              You signed
            </span>
          ) : waiting ? (
            <span className="inline-flex items-center gap-1 rounded-pill bg-accent-container px-2 py-0.5 text-label font-medium text-accent">
              <PenLine size={11} aria-hidden />
              Needs you
            </span>
          ) : null}

          <span className="inline-flex items-center gap-1 rounded-pill bg-surface px-2 py-0.5 text-label text-text-muted">
            <Clock size={11} aria-hidden />
            {ageLabel(proposal.createdAt)}
          </span>
        </div>

        <h2 className="line-clamp-2 text-body font-medium">{proposal.title}</h2>

        {/*
          What it does, in the words the detail screen will use — the same
          sentence `describeMessage` puts at the top of each message card, so
          the card and the thing it opens agree.
        */}
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-label text-text-faint">
          {first ? <span className="min-w-0 truncate">{first.headline}</span> : null}
          {extra > 0 ? <span>and {extra} more</span> : null}
          <span>sequence {proposal.sequence}</span>
        </div>

        {/* Pushed to the bottom so every card's bar sits on the same line,
            however tall the title above it turned out. */}
        <div className="mt-auto pt-1">
          <SignatureBar collected={entry.signatures.length} threshold={threshold} done={!open} />
        </div>
      </Link>
    </li>
  )
}

const TONES: Record<ProposalStage, { color: string; live?: boolean }> = {
  collecting: { color: 'var(--color-accent)', live: true },
  ready: { color: 'var(--color-positive)', live: true },
  broadcast: { color: 'var(--color-positive)' },
  refused: { color: 'var(--color-negative)' }
}

/**
 * The same badge the governance screen uses, on this screen's own vocabulary.
 *
 * Tinted from the text colour with `color-mix` rather than from a second hex,
 * so it tracks the theme — see `StatusBadge`, which does this for the chain's
 * statuses and whose look this deliberately copies.
 */
export function StageBadge({ stage, className }: { stage: ProposalStage; className?: string }) {
  const tone = TONES[stage]

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill px-2.5 py-0.5',
        'text-label font-semibold',
        className
      )}
      style={{ color: tone.color, backgroundColor: `color-mix(in srgb, ${tone.color} 16%, transparent)` }}
    >
      {tone.live ? (
        <span
          aria-hidden
          className="size-1.5 rounded-pill motion-safe:animate-pulse"
          style={{ backgroundColor: tone.color }}
        />
      ) : null}
      {STAGE_LABELS[stage]}
    </span>
  )
}

/**
 * Signatures as pips, one per signature the threshold needs.
 *
 * Not a proportional bar: a threshold is two or three or five, and drawing "2
 * of 3" as a bar 67% full invites reading it as a percentage of something. The
 * pips are countable, which is what this number is for.
 */
export function SignatureBar({
  collected,
  threshold,
  done = false
}: {
  collected: number
  threshold: number
  done?: boolean
}) {
  const filled = Math.min(collected, threshold)
  const complete = collected >= threshold

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="flex h-2 w-full gap-1"
        role="img"
        aria-label={`${collected} of ${threshold} signatures`}
      >
        {Array.from({ length: threshold }, (_, index) => (
          <span
            key={index}
            className={cn(
              'h-full flex-1 rounded-pill',
              index < filled ? (complete ? 'bg-positive' : 'bg-accent') : 'bg-surface'
            )}
          />
        ))}
      </div>
      <p className="text-label text-text-faint">
        {collected} of {threshold} signatures
        {done ? '' : complete ? ' — enough to send' : ''}
      </p>
    </div>
  )
}

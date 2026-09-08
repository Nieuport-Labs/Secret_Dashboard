import { useState } from 'react'

import type { ValidatorVote } from '@/hooks/useValidatorVotes'
import { useBalances } from '@/hooks/useBalances'
import { useStaking } from '@/hooks/useStaking'
import { useStakingActions } from '@/hooks/useStakingActions'
import { useValidatorImages } from '@/hooks/useValidatorImages'
import StakeModal from '@/pages/staking/components/StakeModal'
import ValidatorAvatar from '@/pages/staking/components/ValidatorAvatar'
import { DISPLAY_DENOM } from '@/chains/secret4'
import { formatDisplayAmount } from '@/lib/format'
import { VOTE_LABELS, type VoteOption } from '@/lib/governance'
import { shareOfBonded, type Validator } from '@/lib/staking'
import { squarify } from '@/lib/treemap'
import { VOTE_COLORS } from '@/pages/governance/components/voteColors'

interface Props {
  votes: ValidatorVote[]
  /** Everything bonded network-wide, in base units — the whole a validator's
   *  share is measured against. */
  bondedTokens: bigint
  /** Hovered from the vote breakdown beside this chart, so hovering "Yes"
   *  there highlights every "Yes" validator here without touching this
   *  chart's own per-tile hover. */
  hoveredOption?: VoteOption
  loading?: boolean
  error?: string
}

const CANVAS_WIDTH = 720
const CANVAS_HEIGHT = 300

/**
 * Every validator that has voted so far, as a squarified treemap: area is
 * each validator's share of everything bonded, colour is how it voted.
 * Validators that have not voted yet are left out entirely rather than drawn
 * grey — the one thing this chart answers is who has moved so far, and on a
 * proposal early in its voting period forty near-silent tiles buried that
 * under noise.
 *
 * Clicking a tile opens the same stake/unstake/move panel the staking page
 * does — seeing how a validator voted is exactly the moment someone might
 * want to move their stake toward or away from them, so that flow is wired
 * in here rather than only linking out to the staking page.
 */
export default function ValidatorVoteMap({ votes, bondedTokens, hoveredOption, loading, error }: Props) {
  const [hovered, setHovered] = useState<string | undefined>()
  const [selected, setSelected] = useState<Validator | undefined>()

  const staking = useStaking()
  const balances = useBalances(undefined)
  const actions = useStakingActions(() => staking.refresh())
  const images = useValidatorImages(staking.validators)

  /** A tile dims when either hover source picks out someone else — its own
   *  hover, or the vote-breakdown's per-option one. */
  const dimmed = (validator: { address: string }, option: VoteOption | undefined) =>
    (hovered !== undefined && hovered !== validator.address) ||
    (hoveredOption !== undefined && hoveredOption !== option)

  if (error) {
    return (
      <p className="text-label text-text-faint" role="alert">
        Validator votes could not be read: {error}
      </p>
    )
  }

  const cast = votes
    .filter((v) => v.option && BigInt(v.validator.tokens) > 0n)
    .sort((a, b) => (BigInt(b.validator.tokens) > BigInt(a.validator.tokens) ? 1 : -1))

  if (cast.length === 0) {
    if (loading) {
      return (
        <div
          className="w-full animate-pulse rounded-card bg-surface"
          style={{ aspectRatio: `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}` }}
          aria-busy
        />
      )
    }
    return <p className="text-label text-text-faint">No votes yet.</p>
  }

  const total = bondedTokens > 0n ? Number(bondedTokens) : cast.reduce((sum, v) => sum + Number(v.validator.tokens), 0)
  const share = (tokens: string) => (total > 0 ? (Number(tokens) / total) * 100 : 0)

  const rects = squarify(
    cast.map(({ validator }) => Number(validator.tokens)),
    CANVAS_WIDTH,
    CANVAS_HEIGHT
  )

  return (
    <div className="flex flex-col gap-3">
      <div
        className="relative w-full overflow-hidden rounded-card"
        role="img"
        style={{ aspectRatio: `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}` }}
        aria-label={`Validators that have voted so far: ${cast
          .map(({ validator, option }) => `${validator.moniker} ${VOTE_LABELS[option!]} ${share(validator.tokens).toFixed(2)}%`)
          .join(', ')}.`}
      >
        {cast.map(({ validator, option }, index) => {
          const rect = rects[index]
          if (!rect) return null

          const showAvatar = rect.width >= 32 && rect.height >= 32
          const showLabel = rect.width >= 80 && rect.height >= 40

          return (
            <button
              key={validator.address}
              type="button"
              onClick={() => setSelected(validator)}
              onPointerEnter={() => setHovered(validator.address)}
              onPointerLeave={() => setHovered(undefined)}
              style={{
                left: `${(rect.x / CANVAS_WIDTH) * 100}%`,
                top: `${(rect.y / CANVAS_HEIGHT) * 100}%`,
                width: `${(rect.width / CANVAS_WIDTH) * 100}%`,
                height: `${(rect.height / CANVAS_HEIGHT) * 100}%`,
                backgroundColor: VOTE_COLORS[option!],
                border: '1px solid var(--color-bg)',
                opacity: dimmed(validator, option) ? 0.3 : 1
              }}
              className="absolute flex cursor-pointer flex-col items-center justify-center gap-1 overflow-hidden p-1 transition-opacity duration-[var(--duration-short)] ease-[var(--ease-standard)]"
              title={`${validator.moniker} — ${VOTE_LABELS[option!]} (${formatDisplayAmount(validator.tokens)} ${DISPLAY_DENOM}, ${share(validator.tokens).toFixed(2)}% of voting power)`}
            >
              {showAvatar ? (
                <ValidatorAvatar
                  address={validator.address}
                  moniker={validator.moniker}
                  image={validator.identity ? images.get(validator.identity) : undefined}
                  size={showLabel ? 32 : 22}
                />
              ) : null}
              {showLabel ? (
                <span
                  className="max-w-full truncate px-1 text-xs font-medium text-white"
                  style={{ textShadow: '0 1px 2px rgb(0 0 0 / 0.45)' }}
                >
                  {validator.moniker}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>

      {selected ? (
        <StakeModal
          validator={selected}
          validators={staking.validators}
          delegation={staking.delegations.get(selected.address)}
          image={selected.identity ? images.get(selected.identity) : undefined}
          images={images}
          networkShare={shareOfBonded(selected, bondedTokens)}
          available={balances.native}
          unbondingSeconds={staking.unbondingSeconds}
          state={actions.state}
          onClose={() => {
            setSelected(undefined)
            actions.reset()
          }}
          onDelegate={(amount) => void actions.delegate(selected.address, amount)}
          onUndelegate={(amount) => void actions.undelegate(selected.address, amount)}
          onRedelegate={(to, amount) => void actions.redelegate(selected.address, to, amount)}
        />
      ) : null}
    </div>
  )
}

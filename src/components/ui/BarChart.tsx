import { useMemo, useState } from 'react'

import type { SeriesPoint } from '@/components/ui/Sparkline'

interface Props {
  points: SeriesPoint[]
  /** Drawn under the cursor and announced as the accessible summary. */
  format: (value: number) => string
  /** Accessible name — a chart with no name is an image with no alt text. */
  label: string
  height?: number
}

const VIEW_W = 600

/**
 * A column chart, for series that are daily buckets rather than a continuous
 * quantity — connecting them with a line (as `Sparkline` does) implies a trend
 * between two unrelated days that isn't there.
 *
 * Same non-library, fixed-viewBox approach as `Sparkline`, for the same reason:
 * one shape does not need a charting dependency.
 */
export default function BarChart({ points, format, label, height = 120 }: Props) {
  const [hover, setHover] = useState<number | undefined>()

  const max = useMemo(() => Math.max(...points.map((point) => point.v), 0), [points])
  const active = hover !== undefined ? points[hover] : undefined

  if (points.length === 0) {
    return (
      <p className="flex items-center justify-center text-label text-text-faint" style={{ height }}>
        No history available.
      </p>
    )
  }

  const gap = (VIEW_W / points.length) * 0.25
  const barWidth = VIEW_W / points.length - gap

  return (
    <figure className="m-0 flex flex-col gap-2">
      <figcaption className="flex min-h-[1.3em] items-baseline justify-between gap-3">
        <span className="text-base tabular-nums">
          {active ? (
            <>
              {format(active.v)}
              <span className="ml-2 text-label text-text-faint">
                {new Date(active.t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </span>
            </>
          ) : null}
        </span>
      </figcaption>

      <div
        className="relative w-full"
        style={{ height }}
        onPointerLeave={() => setHover(undefined)}
        onPointerMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect()
          const ratio = (event.clientX - box.left) / box.width
          setHover(Math.round(Math.min(1, Math.max(0, ratio)) * (points.length - 1)))
        }}
      >
        <svg
          viewBox={`0 0 ${VIEW_W} ${height}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`${label}. Up to ${format(max)}.`}
          className="w-full touch-none"
          style={{ height }}
        >
          {points.map((point, index) => {
            const barHeight = max > 0 ? (point.v / max) * height : 0
            return (
              <rect
                key={point.t}
                x={index * (barWidth + gap) + gap / 2}
                y={height - barHeight}
                width={Math.max(barWidth, 1)}
                height={barHeight}
                fill="var(--color-accent)"
                opacity={hover === undefined || hover === index ? 1 : 0.35}
              />
            )
          })}
        </svg>
      </div>
    </figure>
  )
}

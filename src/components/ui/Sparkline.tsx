import { useId, useMemo, useState } from 'react'

export interface SeriesPoint {
  /** Unix milliseconds. */
  t: number
  v: number
}

interface Props {
  points: SeriesPoint[]
  /** Drawn under the cursor and announced as the accessible summary. */
  format: (value: number) => string
  /** Accessible name — a chart with no name is an image with no alt text. */
  label: string
  height?: number
  /** Fills under the line. Off for a series that is about change, not volume. */
  area?: boolean
}

const VIEW_W = 600

/**
 * A line chart, drawn as SVG rather than pulled from a charting library.
 *
 * Two reasons. A library for one shape on one page is 40–100kB gzipped on a
 * dashboard that already loads secretjs, and every one of them arrives with its
 * own colour, font and tooltip opinions that then have to be argued out of it.
 * This inherits the page's tokens because it has no opinions to argue with.
 *
 * The viewBox is fixed and the element scales: the path is computed once in
 * chart units, and the browser handles every width it is ever shown at.
 */
export default function Sparkline({ points, format, label, height = 120, area = true }: Props) {
  const gradientId = useId()
  const [hover, setHover] = useState<number | undefined>()

  const shape = useMemo(() => {
    if (points.length < 2) return undefined

    const values = points.map((point) => point.v)
    const min = Math.min(...values)
    const max = Math.max(...values)
    // A flat series would divide by zero and, worse, draw a line along the
    // bottom edge as though the value had collapsed. Give it a band to sit in.
    const span = max - min || Math.abs(max) || 1
    const pad = span * 0.12

    const x = (index: number) => (index / (points.length - 1)) * VIEW_W
    const y = (value: number) => height - ((value - min + pad) / (span + pad * 2)) * height

    const line = points.map((point, index) => `${x(index).toFixed(2)},${y(point.v).toFixed(2)}`)
    return {
      line: `M${line.join('L')}`,
      fill: `M0,${height} L${line.join('L')} L${VIEW_W},${height} Z`,
      x,
      y,
      min,
      max
    }
  }, [points, height])

  const first = points[0]?.v
  const last = points[points.length - 1]?.v
  const change = first && last ? (last - first) / Math.abs(first) : undefined
  const active = hover !== undefined ? points[hover] : undefined

  if (!shape) {
    return (
      <p className="flex items-center justify-center text-label text-text-faint" style={{ height }}>
        No history available.
      </p>
    )
  }

  return (
    <figure className="m-0 flex flex-col gap-2">
      {/*
        The current value is the panel's headline, so repeating it here would
        print the same number twice. This line is for the point under the
        cursor — which the headline cannot show — and is otherwise empty.
      */}
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
        {change !== undefined ? (
          <span className={`text-label tabular-nums ${change >= 0 ? 'text-positive' : 'text-negative'}`}>
            {change >= 0 ? '+' : ''}
            {(change * 100).toFixed(1)}%
          </span>
        ) : null}
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
          aria-label={`${label}. ${format(shape.min)} to ${format(shape.max)}.`}
          className="w-full touch-none"
          style={{ height }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {area ? <path d={shape.fill} fill={`url(#${gradientId})`} /> : null}

          {/*
          vectorEffect keeps the stroke 1.5px however far the viewBox is
          stretched — without it a chart squeezed into a narrow column draws a
          fat line and one across a wide screen draws a hairline.
        */}
          <path
            d={shape.line}
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />

          {active ? (
            <line
              x1={shape.x(hover!)}
              y1={0}
              x2={shape.x(hover!)}
              y2={height}
              stroke="var(--color-border-strong)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
        </svg>

        {/*
        The marker is an HTML element rather than an SVG <circle>. The viewBox
        is stretched to the container's width with preserveAspectRatio="none",
        which is what lets one path fill any column — and which would also
        squash a circle into an ellipse. Positioning it outside the SVG keeps
        it round at every width.
      */}
        {active ? (
          <span
            aria-hidden
            className="pointer-events-none absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-pill bg-accent"
            style={{
              left: `${(hover! / (points.length - 1)) * 100}%`,
              top: `${(shape.y(active.v) / height) * 100}%`
            }}
          />
        ) : null}
      </div>
    </figure>
  )
}

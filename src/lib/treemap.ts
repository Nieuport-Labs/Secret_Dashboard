/**
 * Squarified treemap layout — Bruls, Huizing & van Wijk, 1999.
 *
 * Tiles a `width`×`height` rectangle with areas proportional to `values`
 * (assumed already sorted largest first), favouring near-square rectangles
 * over the long slivers a naive slice-and-dice layout produces. That is what
 * makes a treemap readable at a glance: a validator with 4% of the vote and
 * one with 0.4% are both still legible boxes rather than a hairline.
 */

export interface TreemapRect {
  x: number
  y: number
  width: number
  height: number
}

export function squarify(values: number[], width: number, height: number): TreemapRect[] {
  const total = values.reduce((sum, value) => sum + value, 0)
  if (total <= 0 || values.length === 0 || width <= 0 || height <= 0) return []

  const area = width * height
  const scaled = values.map((value) => (value / total) * area)

  const result: TreemapRect[] = []
  let remaining = scaled
  let x = 0
  let y = 0
  let w = width
  let h = height

  while (remaining.length > 0) {
    const shortSide = Math.min(w, h)
    const row = [remaining[0]]
    let i = 1
    while (i < remaining.length && worst(row, shortSide) >= worst([...row, remaining[i]], shortSide)) {
      row.push(remaining[i])
      i++
    }

    const rowSum = row.reduce((sum, value) => sum + value, 0)
    const thickness = shortSide > 0 ? rowSum / shortSide : 0

    // The row lays out across whichever side is currently longer, then that
    // side shrinks by the row's thickness for the rectangle that is left.
    if (w >= h) {
      let cy = y
      for (const value of row) {
        const rowHeight = thickness > 0 ? value / thickness : 0
        result.push({ x, y: cy, width: thickness, height: rowHeight })
        cy += rowHeight
      }
      x += thickness
      w -= thickness
    } else {
      let cx = x
      for (const value of row) {
        const rowWidth = thickness > 0 ? value / thickness : 0
        result.push({ x: cx, y, width: rowWidth, height: thickness })
        cx += rowWidth
      }
      y += thickness
      h -= thickness
    }

    remaining = remaining.slice(row.length)
  }

  return result
}

/** How far a row is from square — the figure squarify minimises row by row. */
function worst(row: number[], shortSide: number): number {
  const sum = row.reduce((a, b) => a + b, 0)
  const max = Math.max(...row)
  const min = Math.min(...row)
  const s2 = shortSide * shortSide
  const sum2 = sum * sum
  return Math.max((s2 * max) / sum2, sum2 / (s2 * min))
}

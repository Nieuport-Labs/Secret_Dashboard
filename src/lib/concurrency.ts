/**
 * Map over items with a ceiling on how many run at once.
 *
 * Public Secret infrastructure is thin — two providers answered correctly when
 * fourteen were probed (docs/chain-facts.md). Firing ninety-odd encrypted
 * queries at once would be rude to them and slower for us, since the node
 * queues them anyway.
 */
export async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  onProgress?: (done: number, total: number) => void
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  let done = 0

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next++
      if (index >= items.length) return
      results[index] = await worker(items[index], index)
      done += 1
      onProgress?.(done, items.length)
    }
  })

  await Promise.all(runners)
  return results
}

/**
 * `first()`, and — if it has not answered well within `delay` ms, or has
 * already failed — `second()` as well; whichever answers well first wins. When
 * neither does, the first one's answer is returned.
 *
 * A hedged request: the cure for a tail of slow answers, at the cost of a
 * second request only for the answers that were slow.
 */
export function hedged<T>(
  first: () => Promise<T>,
  second: () => Promise<T>,
  delay: number,
  good: (answer: T) => boolean
): Promise<T> {
  return new Promise((resolve, reject) => {
    let done = false
    let hedging = false
    const results: Array<{ value: T } | { error: unknown } | undefined> = []

    const finishIfAllIn = () => {
      if (done || results.filter(Boolean).length < (hedging ? 2 : 1)) return
      done = true
      // Neither answered well: the first one's answer, or the second's if the first threw.
      const answer = results.find((result) => result !== undefined && 'value' in result)
      if (answer && 'value' in answer) resolve(answer.value)
      else reject((results[0] as { error: unknown } | undefined)?.error)
    }

    const track = (index: number, attempt: Promise<T>) =>
      attempt.then(
        (value) => {
          results[index] = { value }
          if (!done && good(value)) {
            done = true
            clearTimeout(timer)
            resolve(value)
            return
          }
          // A bad first answer starts the hedge now rather than after the delay.
          if (index === 0) hedge()
          finishIfAllIn()
        },
        (error: unknown) => {
          results[index] = { error }
          if (index === 0) hedge()
          finishIfAllIn()
        }
      )

    const hedge = () => {
      if (done || hedging) return
      hedging = true
      clearTimeout(timer)
      void track(1, second())
    }

    const timer = setTimeout(hedge, delay)
    void track(0, first())
  })
}

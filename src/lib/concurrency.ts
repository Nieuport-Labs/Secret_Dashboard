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

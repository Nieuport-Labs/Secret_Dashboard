/**
 * The Secret dApp registry.
 *
 * Fetched from SecretFoundation/DappRegistry rather than bundled, so the list
 * stays current without a redeploy. Icons are kept locally: they were copied
 * from the registry at build time, so the page works offline and does not
 * announce which dApps someone is browsing to a third party.
 */

const REGISTRY_URL = 'https://raw.githubusercontent.com/SecretFoundation/DappRegistry/main/dAppRegistry.json'

export interface Dapp {
  name: string
  link: string
  description: string
  /** Path under /img/dapps/, or absent. */
  icon?: string
  tags: string[]
}

interface RawDapp {
  name?: string
  link?: string
  description?: string
  icon?: string
  tags?: string[]
}

export async function fetchDapps(): Promise<Dapp[]> {
  const response = await fetch(REGISTRY_URL, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(12_000)
  })
  if (!response.ok) throw new Error(`The dApp registry could not be read: HTTP ${response.status}`)

  const body = (await response.json()) as RawDapp[]
  if (!Array.isArray(body)) throw new Error('The dApp registry returned something unexpected.')

  return body
    .filter((entry): entry is RawDapp & { name: string; link: string } => Boolean(entry?.name && entry?.link))
    .map((entry) => ({
      name: entry.name,
      link: entry.link,
      description: entry.description ?? '',
      icon: entry.icon,
      tags: entry.tags ?? []
    }))
}

/** Every tag present, in the order they first appear. */
export function collectTags(dapps: Dapp[]): string[] {
  const seen = new Set<string>()
  for (const dapp of dapps) for (const tag of dapp.tags) seen.add(tag)
  return [...seen].sort()
}

/**
 * Where to get SCRT.
 *
 * Deliberately a short, checkable list rather than an exhaustive one. Someone
 * who has none needs a next step, not a directory.
 */
export const WHERE_TO_BUY = [
  {
    name: 'Osmosis',
    link: 'https://app.osmosis.zone/?from=USDC&to=SCRT',
    detail: 'Swap on-chain from any Cosmos asset. No account, no sign-up.'
  },
  {
    name: 'Kraken',
    link: 'https://www.kraken.com/prices/secret',
    detail: 'Buy with a bank transfer or card, then withdraw to your own address.'
  },
  {
    name: 'Bridge from another chain',
    link: '/bridge',
    detail: 'Already hold something on Cosmos Hub, Osmosis or Injective? Bring it over.',
    internal: true
  }
]

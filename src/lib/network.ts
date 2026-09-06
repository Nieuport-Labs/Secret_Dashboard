import type { SecretNetworkClient } from 'secretjs'

import { DENOM } from '@/chains/secret4'

/**
 * Chain statistics, read from the chain.
 *
 * The reference dashboard sources these from a third party's scraper at
 * `dashboardstats.secretsaturn.net`. That host no longer resolves, which took
 * five of its panels with it. Everything here comes from Secret's own modules
 * instead: it cannot go stale independently of the chain, and it needs no
 * arrangement with anyone.
 *
 * TVL is the exception — it is a measurement of contracts, not a chain fact —
 * and comes from DefiLlama.
 */

export interface ChainStats {
  /** Latest block height. */
  height: string
  blockTime: Date
  /** Base units. */
  totalSupply: string
  bonded: string
  /** Fraction of supply staked, 0..1. */
  bondedRatio: number
  /** Annual issuance as a fraction, 0..1. */
  inflation?: number
  communityPool?: string
  bondedValidators: number
}

async function getJson<T>(lcd: string, path: string): Promise<T> {
  const response = await fetch(`${lcd.replace(/\/+$/, '')}${path}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(12_000)
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json() as Promise<T>
}

export async function fetchChainStats(lcd: string, client: SecretNetworkClient): Promise<ChainStats> {
  const [pool, supply, inflation, latest, community, validators] = await Promise.all([
    getJson<{ pool?: { bonded_tokens?: string } }>(lcd, '/cosmos/staking/v1beta1/pool'),
    getJson<{ amount?: { amount?: string } }>(lcd, `/cosmos/bank/v1beta1/supply/by_denom?denom=${DENOM}`),
    // Present on Secret, but a chain can disable the mint module; a missing
    // figure is shown as missing rather than as zero inflation.
    getJson<{ inflation?: string }>(lcd, '/cosmos/mint/v1beta1/inflation').catch(
      (): { inflation?: string } => ({})
    ),
    getJson<{ block?: { header?: { height?: string; time?: string } } }>(
      lcd,
      '/cosmos/base/tendermint/v1beta1/blocks/latest'
    ),
    getJson<{ pool?: Array<{ denom?: string; amount?: string }> }>(
      lcd,
      '/cosmos/distribution/v1beta1/community_pool'
    ).catch((): { pool?: Array<{ denom?: string; amount?: string }> } => ({})),
    client.query.staking.validators({ status: 'BOND_STATUS_BONDED', pagination: { limit: '300' } })
  ])

  const bonded = BigInt(pool.pool?.bonded_tokens ?? '0')
  const totalSupply = BigInt(supply.amount?.amount ?? '0')

  return {
    height: latest.block?.header?.height ?? '0',
    blockTime: new Date(latest.block?.header?.time ?? Date.now()),
    totalSupply: totalSupply.toString(),
    bonded: bonded.toString(),
    // Integer maths, then one division at the end, so the ratio never routes a
    // token balance through a float.
    bondedRatio: totalSupply > 0n ? Number((bonded * 10_000n) / totalSupply) / 10_000 : 0,
    inflation: inflation.inflation ? Number(inflation.inflation) : undefined,
    communityPool: community.pool?.find((c) => c.denom === DENOM)?.amount?.split('.')[0],
    bondedValidators: validators.validators?.length ?? 0
  }
}

/**
 * Total value locked in Secret's contracts, in USD.
 *
 * `undefined` when DefiLlama cannot be reached or does not list the chain —
 * never zero, which would read as "nothing is deployed here".
 */
export async function fetchTvl(): Promise<number | undefined> {
  try {
    const chains = (await getJson<Array<{ name?: string; tvl?: number }>>(
      'https://api.llama.fi',
      '/chains'
    )) as Array<{ name?: string; tvl?: number }>

    const secret = chains.find((chain) => chain.name === 'Secret')
    return typeof secret?.tvl === 'number' ? secret.tvl : undefined
  } catch {
    return undefined
  }
}

/**
 * Value locked over time, from DefiLlama.
 *
 * Their series is one point a day at midnight UTC, in seconds rather than
 * milliseconds — the conversion is not optional, and getting it wrong puts
 * every point in 1970.
 */
export async function fetchTvlHistory(): Promise<Array<{ t: number; v: number }>> {
  try {
    const rows = (await getJson<Array<{ date?: number; tvl?: number }>>(
      'https://api.llama.fi',
      '/v2/historicalChainTvl/Secret'
    )) as Array<{ date?: number; tvl?: number }>

    return rows
      .filter((row) => Number.isFinite(row.date) && Number.isFinite(row.tvl))
      .map((row) => ({ t: row.date! * 1000, v: row.tvl! }))
  } catch {
    return []
  }
}

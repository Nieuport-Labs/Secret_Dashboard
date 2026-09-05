/**
 * Phase 0 — verify the assumptions the build rests on, against the live chain.
 *
 * Read-only. Runs on plain Node through --experimental-strip-types, no bundler
 * and no test framework, so it stays runnable when the app around it does not
 * build. Every check reports independently: one failure must not hide the rest,
 * because the point is to learn which assumptions hold, not to pass.
 *
 *   npm run verify:chain
 */

import { SecretNetworkClient } from 'secretjs'

import {
  CHAIN_ID,
  DEFAULT_LCD_URLS,
  DEFAULT_RPC_URLS,
  GAS_VAULT_ADDRESS,
  IBC_HOOKS_WRAPPER
} from '../src/chains/secret4.ts'

/** sSCRT — the token every other check leans on. */
const SSCRT = 'secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek'

/** The CW20-ICS20 fork drained on 2026-06-10. Checked so the finding is on record. */
const EXPLOITED_ICS20 = 'secret1yxjmepvyl2c25vnt53cr2dpn8amknwausxee83'

type Status = 'pass' | 'fail' | 'warn'

interface Result {
  name: string
  status: Status
  detail: string
}

const results: Result[] = []

function record(name: string, status: Status, detail: string): void {
  results.push({ name, status, detail })
  const mark = status === 'pass' ? 'PASS' : status === 'warn' ? 'WARN' : 'FAIL'
  console.log(`[${mark}] ${name}\n       ${detail.replace(/\n/g, '\n       ')}\n`)
}

/** Run a check without letting its failure end the run. */
async function check(name: string, fn: () => Promise<[Status, string]>): Promise<void> {
  try {
    const [status, detail] = await fn()
    record(name, status, detail)
  } catch (error) {
    record(name, 'fail', error instanceof Error ? error.message : String(error))
  }
}

/* -------------------------------------------------------------------------- */
/* Endpoint probing                                                            */
/* -------------------------------------------------------------------------- */

/**
 * A dead public node answers at the HTTP level with an HTML error page, which
 * surfaces as `Unexpected token '<'` from deep inside secretjs. So an endpoint
 * counts as usable only when it returns JSON *and* reports the expected chain.
 */
async function probeLcd(url: string): Promise<{ ok: boolean; reason: string }> {
  try {
    const response = await fetch(`${url.replace(/\/+$/, '')}/cosmos/base/tendermint/v1beta1/node_info`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000)
    })
    if (!response.ok) return { ok: false, reason: `HTTP ${response.status}` }

    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('json')) return { ok: false, reason: `content-type ${contentType || 'absent'}` }

    const body = (await response.json()) as { default_node_info?: { network?: string } }
    const network = body.default_node_info?.network
    if (network !== CHAIN_ID) return { ok: false, reason: `reports chain ${network ?? 'unknown'}` }

    return { ok: true, reason: 'ok' }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
}

async function resolveLcd(): Promise<string> {
  const report: string[] = []
  let chosen: string | undefined

  for (const url of DEFAULT_LCD_URLS) {
    const { ok, reason } = await probeLcd(url)
    report.push(`  ${ok ? 'ok  ' : 'dead'}  ${url}  ${ok ? '' : `(${reason})`}`)
    if (ok && !chosen) chosen = url
  }

  record(
    'LCD endpoints',
    chosen ? (report.filter((line) => line.includes('ok  ')).length > 1 ? 'pass' : 'warn') : 'fail',
    `${chosen ? `using ${chosen}` : 'no endpoint reported ' + CHAIN_ID}\n${report.join('\n')}`
  )

  if (!chosen) throw new Error(`No LCD endpoint reported ${CHAIN_ID}; nothing else can be checked.`)
  return chosen
}

async function probeRpc(): Promise<void> {
  const report: string[] = []
  let alive = 0

  for (const url of DEFAULT_RPC_URLS) {
    try {
      const response = await fetch(`${url.replace(/\/+$/, '')}/status`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000)
      })
      const body = (await response.json()) as { result?: { node_info?: { network?: string } } }
      const network = body.result?.node_info?.network
      const ok = network === CHAIN_ID
      if (ok) alive += 1
      report.push(`  ${ok ? 'ok  ' : 'dead'}  ${url}  ${ok ? '' : `(reports ${network ?? 'nothing'})`}`)
    } catch (error) {
      report.push(`  dead  ${url}  (${error instanceof Error ? error.message : String(error)})`)
    }
  }

  record(
    'RPC endpoints (SNIP-52 WebSocket source)',
    alive > 1 ? 'pass' : alive === 1 ? 'warn' : 'fail',
    `${alive} of ${DEFAULT_RPC_URLS.length} alive\n${report.join('\n')}`
  )
}

/* -------------------------------------------------------------------------- */
/* Contract checks                                                             */
/* -------------------------------------------------------------------------- */

async function codeHashOf(client: SecretNetworkClient, address: string): Promise<string> {
  const response = await client.query.compute.codeHashByContractAddress({ contract_address: address })
  const hash = response.code_hash
  if (!hash) throw new Error(`${address} returned no code hash — is it a contract?`)
  return hash
}

async function main(): Promise<void> {
  console.log(`\nSecret Dashboard — Phase 0 chain verification against ${CHAIN_ID}\n${'='.repeat(70)}\n`)

  const lcd = await resolveLcd()
  await probeRpc()

  const client = new SecretNetworkClient({ url: lcd, chainId: CHAIN_ID })

  /* 1 — Gas vault. The fee-granter's own notes say it is "not yet exercised on
     secret-4", so this is the check that decides whether gas credits ship. */
  await check('Gas vault on secret-4', async () => {
    const codeHash = await codeHashOf(client, GAS_VAULT_ADDRESS)
    const status = (await client.query.compute.queryContract({
      contract_address: GAS_VAULT_ADDRESS,
      code_hash: codeHash,
      query: { status: {} }
    })) as { balance?: string }

    if (typeof status?.balance !== 'string') {
      return ['fail', `code hash ${codeHash} but {status:{}} returned ${JSON.stringify(status)}`]
    }

    const scrt = (Number(status.balance) / 1e6).toFixed(6)
    return [
      'pass',
      `${GAS_VAULT_ADDRESS}\n  code hash ${codeHash}\n  balance ${status.balance} uscrt (${scrt} SCRT) — also the sum of its outstanding allowances`
    ]
  })

  /* 2 — SNIP-52 on sSCRT. Decides which tokens get push and which stay on
     polling. `list_channels` needs no auth; `channel_info` does. */
  await check('SNIP-52 channels on sSCRT', async () => {
    const codeHash = await codeHashOf(client, SSCRT)
    const reply = (await client.query.compute.queryContract({
      contract_address: SSCRT,
      code_hash: codeHash,
      query: { list_channels: {} }
    })) as { list_channels?: { channels?: string[] } }

    const channels = reply?.list_channels?.channels
    if (!Array.isArray(channels) || channels.length === 0) {
      return ['fail', `code hash ${codeHash} but no channels: ${JSON.stringify(reply)}`]
    }

    return ['pass', `code hash ${codeHash}\n  channels: ${channels.join(', ')}`]
  })

  /* 3 — SNIP-24 support, the other half of dropping viewing keys. A contract
     that knows the query answers "unauthorized", not "unknown variant". */
  await check('SNIP-24 permit support on sSCRT', async () => {
    const codeHash = await codeHashOf(client, SSCRT)

    // A structurally valid permit carrying a deliberately wrong signature. A
    // contract that implements SNIP-24 gets far enough to verify the signature
    // and complains about *that*; one that does not know the query fails much
    // earlier with an unknown variant. The difference is the whole test — a
    // null permit only proves the JSON was rejected, which says nothing.
    const bogusPermit = {
      params: {
        permit_name: 'verify-chain-probe',
        allowed_tokens: [SSCRT],
        chain_id: CHAIN_ID,
        permissions: ['balance']
      },
      signature: {
        pub_key: { type: 'tendermint/PubKeySecp256k1', value: 'A'.repeat(44) },
        signature: 'A'.repeat(86) + '=='
      }
    }

    const reply = await client.query.compute
      .queryContract({
        contract_address: SSCRT,
        code_hash: codeHash,
        query: { with_permit: { permit: bogusPermit, query: { balance: {} } } }
      })
      .then((r) => JSON.stringify(r))
      .catch((error: unknown) => (error instanceof Error ? error.message : String(error)))

    if (/unknown variant|missing field/i.test(reply)) {
      return ['fail', `contract does not implement with_permit: ${reply.slice(0, 200)}`]
    }
    return [
      'pass',
      `contract parses with_permit and reached signature verification, as a SNIP-24 token should\n  ${reply.slice(0, 200)}`
    ]
  })

  /* 3a — The transfer_history query shape the wallet screen sends. Same probe
     technique: a wrong signature proves the contract parsed the query. */
  await check('SNIP-24 transfer_history query shape', async () => {
    const codeHash = await codeHashOf(client, SSCRT)
    const bogusPermit = {
      params: {
        permit_name: 'verify-chain-probe',
        allowed_tokens: [SSCRT],
        chain_id: CHAIN_ID,
        permissions: ['history']
      },
      signature: {
        pub_key: { type: 'tendermint/PubKeySecp256k1', value: 'A'.repeat(44) },
        signature: 'A'.repeat(86) + '=='
      }
    }

    const reply = await client.query.compute
      .queryContract({
        contract_address: SSCRT,
        code_hash: codeHash,
        query: {
          with_permit: { permit: bogusPermit, query: { transfer_history: { page: 0, page_size: 1 } } }
        }
      })
      .then((r) => JSON.stringify(r))
      .catch((error: unknown) => (error instanceof Error ? error.message : String(error)))

    if (/unknown variant|missing field/i.test(reply)) {
      return ['fail', `the contract does not accept this query shape: ${reply.slice(0, 200)}`]
    }
    return ['pass', `shape accepted; rejected on the signature as expected\n  ${reply.slice(0, 160)}`]
  })

  /* 3b — The WebSocket SNIP-52 actually subscribes over, not just the HTTP RPC. */
  await check('Tendermint WebSocket reachable', async () => {
    const candidates = DEFAULT_RPC_URLS.map(
      (url) => url.replace(/^http/, 'ws').replace(/\/+$/, '') + '/websocket'
    )

    for (const wsUrl of candidates) {
      const outcome = await new Promise<string>((resolve) => {
        const socket = new WebSocket(wsUrl)
        const timer = setTimeout(() => {
          socket.close()
          resolve('timeout')
        }, 8000)

        socket.onopen = () => {
          socket.send(
            JSON.stringify({
              jsonrpc: '2.0',
              id: '0',
              method: 'subscribe',
              params: { query: "tm.event='NewBlock'" }
            })
          )
        }
        socket.onmessage = () => {
          clearTimeout(timer)
          socket.close()
          resolve('ok')
        }
        socket.onerror = () => {
          clearTimeout(timer)
          resolve('error')
        }
      })

      if (outcome === 'ok') return ['pass', `${wsUrl} accepted a subscription`]
    }

    return [
      'fail',
      `no RPC accepted a WebSocket subscription — SNIP-52 push cannot work:\n  ${candidates.join('\n  ')}`
    ]
  })

  /* 4 — The auto-wrap hook target. Not the contract drained in June, but after
     that incident nothing IBC-adjacent gets taken on trust from the reference. */
  await check('IBC-hooks auto-wrap contract', async () => {
    const codeHash = await codeHashOf(client, IBC_HOOKS_WRAPPER)
    const info = await client.query.compute.contractInfo({ contract_address: IBC_HOOKS_WRAPPER })
    const label = info.contract_info?.label ?? 'unknown'
    const codeId = info.contract_info?.code_id ?? 'unknown'
    return ['pass', `${IBC_HOOKS_WRAPPER}\n  label "${label}", code id ${codeId}\n  code hash ${codeHash}`]
  })

  /* 5 — The exploited Axelar bridge contract, recorded rather than trusted. */
  await check('Exploited CW20-ICS20 (2026-06-10) — state on record', async () => {
    const info = await client.query.compute.contractInfo({ contract_address: EXPLOITED_ICS20 })
    const label = info.contract_info?.label ?? 'unknown'
    const codeId = info.contract_info?.code_id ?? 'unknown'
    return [
      'warn',
      `${EXPLOITED_ICS20}\n  label "${label}", code id ${codeId}\n  Axelar<>Secret routes were disabled after the drain — do not offer them in the UI`
    ]
  })

  /* 6 — Auto-restake minimum, read from the chain instead of hardcoded. */
  await check('Auto-restake threshold (distribution params)', async () => {
    const response = await fetch(`${lcd}/cosmos/distribution/v1beta1/params`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000)
    })
    const body = (await response.json()) as { params?: Record<string, unknown> }
    const params = body.params ?? {}
    const threshold = params.minimum_restake_threshold ?? params.minimum_restake_amount
    const period = params.restake_period

    if (threshold === undefined) {
      return ['warn', `no restake threshold in params: ${JSON.stringify(params)}`]
    }

    const scrt = (Number(threshold) / 1e6).toFixed(6)
    return [
      'pass',
      `minimum_restake_threshold ${threshold} uscrt (${scrt} SCRT), restake_period ${String(period ?? 'n/a')}`
    ]
  })

  /* 7 — The feegrant module answers, and in the shape the SDK parses. */
  await check('x/feegrant allowances query', async () => {
    const response = await fetch(
      `${lcd}/cosmos/feegrant/v1beta1/allowances/${GAS_VAULT_ADDRESS}?pagination.limit=1`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) }
    )
    if (!response.ok) return ['fail', `HTTP ${response.status}`]
    const body = (await response.json()) as { allowances?: unknown[] }
    if (!Array.isArray(body.allowances))
      return ['fail', `unexpected shape: ${JSON.stringify(body).slice(0, 200)}`]
    return [
      'pass',
      `module answers; ${body.allowances.length} allowance(s) for the vault as grantee (0 is normal)`
    ]
  })

  /* 8 — Gas price actually enforced, since a fee estimated too low makes a
     grant look able to cover a transaction it then fails. */
  await check('Minimum gas price', async () => {
    const response = await fetch(`${lcd}/cosmos/base/node/v1beta1/config`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000)
    })
    if (!response.ok) return ['warn', `node config unavailable (HTTP ${response.status}); keeping 0.1 uscrt`]
    const body = (await response.json()) as { minimum_gas_price?: string }
    return [
      'pass',
      `node reports minimum_gas_price "${body.minimum_gas_price ?? 'empty'}" (app uses 0.1 uscrt)`
    ]
  })

  /* Summary */
  const counts = results.reduce<Record<Status, number>>(
    (acc, r) => ({ ...acc, [r.status]: acc[r.status] + 1 }),
    { pass: 0, warn: 0, fail: 0 }
  )

  console.log('='.repeat(70))
  console.log(`pass ${counts.pass}   warn ${counts.warn}   fail ${counts.fail}\n`)
  for (const r of results.filter((r) => r.status !== 'pass')) {
    console.log(`  ${r.status.toUpperCase().padEnd(5)} ${r.name}`)
  }
  console.log()

  // A failed assumption is information, not a broken run — the exit code stays 0
  // so the output is always read rather than swallowed by a CI failure.
}

await main()

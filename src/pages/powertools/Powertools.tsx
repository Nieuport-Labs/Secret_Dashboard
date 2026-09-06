import { CheckCircle2, Info, Play, XCircle } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import Button from '@/components/ui/Button'
import { DEFAULT_LCD_URLS, DEFAULT_RPC_URLS } from '@/chains/secret4'
import { codeHashFor } from '@/lib/codeHash'
import { parseEndpointList, probeLcd, probeRpc, type ProbeResult } from '@/lib/endpoint'
import { useSettings } from '@/store/settings'
import { useWallet } from '@/store/wallet'

/**
 * Tools for looking at the chain directly.
 *
 * Read-only on purpose. Composing and signing an arbitrary transaction is a
 * genuinely useful thing to have, and also the fastest way to lose funds to a
 * typo in a JSON field nobody reviewed. `secretcli` already does it, with a
 * terminal's friction around it. What is here instead is the part that is safe
 * and still answers most questions: which endpoints work, and what a contract
 * actually says.
 */
export default function Powertools() {
  const client = useWallet((state) => state.queryClient)
  const settings = useSettings()

  const [endpoints, setEndpoints] = useState<Array<ProbeResult & { kind: 'LCD' | 'RPC' }>>([])
  const [probing, setProbing] = useState(false)

  const probeAll = useCallback(async () => {
    setProbing(true)
    const lcds = parseEndpointList(settings.lcdOverride)
    const rpcs = parseEndpointList(settings.rpcOverride)

    const results = await Promise.all([
      ...(lcds.length > 0 ? lcds : DEFAULT_LCD_URLS).map(async (url) => ({
        ...(await probeLcd(url)),
        kind: 'LCD' as const
      })),
      ...(rpcs.length > 0 ? rpcs : DEFAULT_RPC_URLS).map(async (url) => ({
        ...(await probeRpc(url)),
        kind: 'RPC' as const
      }))
    ])

    setEndpoints(results)
    setProbing(false)
  }, [settings.lcdOverride, settings.rpcOverride])

  useEffect(() => {
    void probeAll()
  }, [probeAll])

  return (
    <div className="mx-auto flex max-w-[760px] flex-col gap-8">
      <h1 className="text-4xl font-semibold text-accent">Powertools</h1>

      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold">Endpoints</h2>
          <Button variant="ghost" size="sm" loading={probing} onClick={() => void probeAll()}>
            Re-check
          </Button>
        </div>

        <ul className="flex flex-col gap-2">
          {endpoints.map((endpoint) => (
            <li
              key={`${endpoint.kind}-${endpoint.url}`}
              className="flex items-start gap-3 rounded-card bg-surface-1 px-4 py-3"
            >
              {endpoint.ok ? (
                <CheckCircle2 size={18} aria-hidden className="mt-0.5 shrink-0 text-positive" />
              ) : (
                <XCircle size={18} aria-hidden className="mt-0.5 shrink-0 text-text-faint" />
              )}
              <span className="min-w-0">
                <span className="break-address block text-base">{endpoint.url}</span>
                <span className="block text-sm text-text-faint">
                  {endpoint.kind}
                  {endpoint.ok ? '' : ` · ${endpoint.reason}`}
                </span>
              </span>
            </li>
          ))}
        </ul>

        <p className="flex items-start gap-2 text-sm text-text-faint">
          <Info size={14} aria-hidden className="mt-0.5 shrink-0" />
          An endpoint counts as working only if it answers with JSON <em>and</em> reports secret-4. One listed
          in the cosmos chain-registry under Secret serves a different chain entirely.
        </p>
      </section>

      <ContractQuery client={client} />
    </div>
  )
}

/**
 * Query any contract.
 *
 * The code hash is fetched rather than asked for: a query is encrypted against
 * it, and requiring someone to paste the right one turns a useful tool into a
 * puzzle. It is shown afterwards, since that is often the thing being looked up.
 */
function ContractQuery({ client }: { client?: ReturnType<typeof useWallet.getState>['queryClient'] }) {
  const [address, setAddress] = useState('')
  const [query, setQuery] = useState('{ "token_info": {} }')
  const [result, setResult] = useState<string | undefined>()
  const [codeHash, setCodeHash] = useState<string | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [running, setRunning] = useState(false)

  const run = async () => {
    if (!client || !address.trim()) return
    setRunning(true)
    setError(undefined)
    setResult(undefined)
    setCodeHash(undefined)

    try {
      const parsed: unknown = JSON.parse(query)
      const hash = await codeHashFor(client, address.trim())
      setCodeHash(hash)

      const reply = await client.query.compute.queryContract({
        contract_address: address.trim(),
        code_hash: hash,
        query: parsed as object
      })
      setResult(JSON.stringify(reply, null, 2))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setRunning(false)
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Query a contract</h2>

      <label className="flex flex-col gap-2">
        <span className="text-base font-medium">Contract address</span>
        <input
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          placeholder="secret1…"
          spellCheck={false}
          className="rounded-control bg-surface px-4 py-3 font-mono text-sm outline-none placeholder:text-text-faint"
        />
      </label>

      <label className="flex flex-col gap-2">
        <span className="text-base font-medium">Query</span>
        <textarea
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          rows={4}
          spellCheck={false}
          className="resize-y rounded-control bg-surface px-4 py-3 font-mono text-sm outline-none"
        />
      </label>

      <Button
        variant="primary"
        loading={running}
        disabled={!client || !address.trim()}
        icon={<Play size={16} aria-hidden />}
        onClick={() => void run()}
      >
        Run
      </Button>

      {codeHash ? (
        <p className="break-address text-sm text-text-faint">
          code hash <span className="font-mono">{codeHash}</span>
        </p>
      ) : null}

      {error ? (
        <pre className="whitespace-pre-wrap break-words rounded-card bg-surface-1 p-4 font-mono text-sm text-negative">
          {error}
        </pre>
      ) : null}

      {result ? (
        <pre className="overflow-x-auto rounded-card bg-surface-1 p-4 font-mono text-sm">{result}</pre>
      ) : null}
    </section>
  )
}

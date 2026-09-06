import { Play } from 'lucide-react'
import { useState } from 'react'

import Button from '@/components/ui/Button'
import { codeHashFor } from '@/lib/codeHash'
import { useWallet } from '@/store/wallet'

/**
 * Tools for looking at the chain directly.
 *
 * Read-only on purpose. Composing and signing an arbitrary transaction is a
 * genuinely useful thing to have, and also the fastest way to lose funds to a
 * typo in a JSON field nobody reviewed. `secretcli` already does it, with a
 * terminal's friction around it. What is here instead is the part that is safe
 * and still answers most questions: what a contract actually says.
 *
 * Endpoint health used to live here as well. It has moved out: the endpoints
 * are *set* in Settings, and a reading that is one screen away from the control
 * it describes is a reading nobody acts on.
 */
export default function Powertools() {
  const client = useWallet((state) => state.queryClient)

  return (
    <div className="mx-auto flex max-w-[760px] flex-col gap-10">
      <h1 className="text-display">Powertools</h1>
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
    <section className="flex flex-col gap-5">
      <h2 className="text-title">Query a contract</h2>

      <label className="flex flex-col gap-2">
        <span className="text-base font-medium">Contract address</span>
        <input
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          placeholder="secret1…"
          spellCheck={false}
          className="rounded-control border border-border bg-surface px-3 py-2.5 font-mono text-sm outline-none placeholder:text-text-faint"
        />
      </label>

      <label className="flex flex-col gap-2">
        <span className="text-base font-medium">Query</span>
        <textarea
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          rows={4}
          spellCheck={false}
          className="resize-y rounded-control border border-border bg-surface px-3 py-2.5 font-mono text-sm outline-none"
        />
      </label>

      <Button
        variant="primary"
        className="self-start"
        loading={running}
        disabled={!client || !address.trim()}
        icon={<Play size={14} aria-hidden />}
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
        <pre className="whitespace-pre-wrap break-words card p-4 font-mono text-sm text-negative">
          {error}
        </pre>
      ) : null}

      {result ? <pre className="overflow-x-auto card p-4 font-mono text-sm">{result}</pre> : null}
    </section>
  )
}

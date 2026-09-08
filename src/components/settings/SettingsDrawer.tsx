import { CheckCircle2, ChevronDown, Trash2, XCircle } from 'lucide-react'
import { useState } from 'react'

import Button from '@/components/ui/Button'
import Drawer from '@/components/ui/Drawer'
import { DEFAULT_LCD_URLS, DEFAULT_RPC_URLS, DISPLAY_DENOM } from '@/chains/secret4'
import {
  forgetResolvedEndpoints,
  parseEndpointList,
  probeLcd,
  probeRpc,
  type ProbeResult
} from '@/lib/endpoint'
import { usePermit } from '@/hooks/usePermit'
import { errorMessage } from '@/lib/errors'
import { availableFee, type FeeGrant } from '@/lib/feegrant-sdk'
import { formatAmount, shortenAddress } from '@/lib/format'
import { queryTokenInfo } from '@/lib/snip20'
import { rememberTokens } from '@/lib/watchlist'
import { cn } from '@/lib/cn'
import { useCustomTokens } from '@/store/customTokens'
import { useFeePayer } from '@/store/feePayer'
import { useSettings, type FeeMode, type Theme } from '@/store/settings'
import { useWallet } from '@/store/wallet'

interface Props {
  open: boolean
  onClose: () => void
}

/**
 * The three fee modes, worded the way the SDK actually behaves.
 *
 * "Auto" does not mean "when I am short". A grant is a standing offer, made so
 * it would be used, so Auto spends one whenever it covers the fee even if the
 * wallet could pay. There is deliberately no "only when low" mode, because that
 * would quietly decline something someone offered.
 */
const FEE_MODES: Array<{ value: FeeMode; label: string; detail: string }> = [
  {
    value: 'auto',
    label: 'Auto',
    detail: 'Use the best grant whenever one covers the fee. Falls back to this wallet when none can.'
  },
  {
    value: 'select',
    label: 'Choose',
    detail: 'Always use one particular grant, falling back to this wallet when it cannot pay.'
  },
  {
    value: 'off',
    label: 'This wallet',
    detail: 'Never spend a grant, even when one is usable.'
  }
]

export default function SettingsDrawer({ open, onClose }: Props) {
  const settings = useSettings()
  const grants = useFeePayer((state) => state.grants)
  const activeFeeMode = FEE_MODES.find((mode) => mode.value === settings.feeMode) ?? FEE_MODES[0]

  return (
    <Drawer open={open} onClose={onClose} title="Settings">
      <section className="flex flex-col gap-3">
        <h3 className="text-base font-semibold">Transaction fees</h3>

        <div className="flex items-center gap-1 rounded-pill border border-border p-1">
          {FEE_MODES.map((mode) => (
            <button
              key={mode.value}
              type="button"
              onClick={() => settings.set('feeMode', mode.value)}
              aria-pressed={settings.feeMode === mode.value}
              className={cn(
                'state-layer flex-1 rounded-pill px-3 py-2 text-sm font-medium transition-colors duration-[var(--duration-short)] ease-[var(--ease-standard)]',
                settings.feeMode === mode.value
                  ? 'bg-accent-strong text-[var(--color-accent-text)]'
                  : 'text-text-muted'
              )}
            >
              {mode.label}
            </button>
          ))}
        </div>

        <p className="text-sm text-text-faint">{activeFeeMode.detail}</p>

        {settings.feeMode === 'select' ? <GranterPicker grants={grants} /> : null}
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-base font-semibold">Appearance</h3>
        <div className="flex gap-2">
          {(['dark', 'light'] as Theme[]).map((theme) => (
            <button
              key={theme}
              type="button"
              onClick={() => settings.set('theme', theme)}
              className={cn(
                'state-layer flex-1 rounded-control px-4 py-2.5 text-base font-medium capitalize',
                settings.theme === theme ? 'bg-accent-container text-accent' : 'bg-surface'
              )}
            >
              {theme}
            </button>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-base font-semibold">Currency</h3>
        <select
          value={settings.currency}
          onChange={(event) => settings.set('currency', event.target.value)}
          className="rounded-control border border-border bg-surface px-3 py-2 text-base outline-none"
        >
          {CURRENCIES.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
        <p className="text-sm text-text-faint">Prices only. Balances are always the real token amounts.</p>
      </section>

      <EndpointSection />

      <PermitSection />

      <section className="flex flex-col gap-3">
        <h3 className="text-base font-semibold">Notifications</h3>
        <label className="state-layer flex cursor-pointer items-start gap-3 rounded-control bg-surface p-3">
          <input
            type="checkbox"
            checked={settings.notificationsEnabled}
            onChange={(event) => settings.set('notificationsEnabled', event.target.checked)}
            className="mt-1 size-4 shrink-0 accent-[var(--color-accent)]"
          />
          <span>
            <span className="block text-base font-medium">Private push notifications</span>
            <span className="block text-sm text-text-muted">
              Tells you when a private token arrives, without polling. Turning this off falls back to checking
              periodically, which still works.
            </span>
          </span>
        </label>
      </section>

      <CustomTokensSection />
    </Drawer>
  )
}

function GranterPicker({ grants }: { grants: FeeGrant[] }) {
  const feeGranter = useSettings((state) => state.feeGranter)
  const set = useSettings((state) => state.set)

  if (grants.length === 0) {
    return (
      <p className="rounded-control bg-surface p-3 text-sm text-text-muted">
        Nobody is currently covering fees for this address. An empty list is not proof none exists — it can
        also mean the grant list could not be read.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {grants.map((grant) => {
        const left = availableFee(grant)
        return (
          <label
            key={grant.granter}
            className={cn(
              'state-layer flex cursor-pointer items-center justify-between gap-3 rounded-control p-3',
              feeGranter === grant.granter ? 'bg-accent-container' : 'bg-surface'
            )}
          >
            <input
              type="radio"
              name="fee-granter"
              checked={feeGranter === grant.granter}
              onChange={() => set('feeGranter', grant.granter)}
              className="sr-only"
            />
            <span className="min-w-0">
              <span className="block truncate text-base">{shortenAddress(grant.granter)}</span>
              <span className="block text-sm text-text-faint">
                {grant.kind === 'periodic' ? 'refills' : 'one-time'}
              </span>
            </span>
            <span className="shrink-0 text-base">
              {left === undefined ? 'uncapped' : `${formatAmount(left.toString())} ${DISPLAY_DENOM}`}
            </span>
          </label>
        )
      })}
    </div>
  )
}

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CHF', 'CZK', 'JPY', 'AUD', 'CAD']

/**
 * Endpoint overrides.
 *
 * Worth having in reach rather than buried: Secret has two working public
 * providers, so "the app is broken" and "both nodes are having a bad morning"
 * look the same from here. Each field takes a comma-separated list and the app
 * uses the first entry that answers with JSON and reports secret-4 — pasting a
 * dead one costs nothing.
 */
function EndpointSection() {
  const settings = useSettings()
  const [checking, setChecking] = useState(false)
  const [results, setResults] = useState<ProbeResult[]>([])

  const check = async () => {
    setChecking(true)
    // Falls back to the built-in list rather than checking nothing. Endpoint
    // health used to have its own panel in Powertools; it belongs next to the
    // fields that set them, and "check" has to mean something when they are
    // empty, since empty is the normal case.
    const lcds = parseEndpointList(settings.lcdOverride)
    const rpcs = parseEndpointList(settings.rpcOverride)
    setResults([
      ...(await Promise.all((lcds.length > 0 ? lcds : DEFAULT_LCD_URLS).map(probeLcd))),
      ...(await Promise.all((rpcs.length > 0 ? rpcs : DEFAULT_RPC_URLS).map(probeRpc)))
    ])
    setChecking(false)
  }

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-base font-semibold">Endpoints</h3>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm text-text-muted">LCD</span>
        <input
          value={settings.lcdOverride}
          onChange={(event) => settings.set('lcdOverride', event.target.value)}
          placeholder="Leave empty for the built-in list"
          spellCheck={false}
          className="rounded-control border border-border bg-surface px-3 py-2 font-mono text-sm outline-none placeholder:text-text-faint"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm text-text-muted">RPC</span>
        <input
          value={settings.rpcOverride}
          onChange={(event) => settings.set('rpcOverride', event.target.value)}
          placeholder="Leave empty for the built-in list"
          spellCheck={false}
          className="rounded-control border border-border bg-surface px-3 py-2 font-mono text-sm outline-none placeholder:text-text-faint"
        />
      </label>

      <div className="flex items-center gap-2">
        <Button variant="soft" shape="control" size="sm" loading={checking} onClick={() => void check()}>
          Check
        </Button>
        {/*
          Resolved endpoints are cached for the page load, so a change does not
          take effect until that cache is dropped. Saying so beats leaving
          someone to wonder why their new node is not being used.
        */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            forgetResolvedEndpoints()
            window.location.reload()
          }}
        >
          Apply and reload
        </Button>
      </div>

      {results.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {results.map((result) => (
            <li key={result.url} className="flex items-start gap-2 text-sm">
              {result.ok ? (
                <CheckCircle2 size={14} aria-hidden className="mt-0.5 shrink-0 text-positive" />
              ) : (
                <XCircle size={14} aria-hidden className="mt-0.5 shrink-0 text-text-faint" />
              )}
              <span className="break-address min-w-0">
                {result.url}
                {result.ok ? '' : ` — ${result.reason}`}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

/**
 * The query permit.
 *
 * Forgetting it locally is not the same as revoking it on chain, and the
 * difference matters: a revoked permit is dead everywhere, a forgotten one is
 * just gone from this browser. Revoking costs a transaction and revokes by
 * name, so a new permit under the same name would still be refused — which is
 * why only the local half is offered here.
 */
/**
 * Add a SNIP-20 by contract address instead of waiting for the registry.
 *
 * Collapsed by default and tucked below the permit section — this is for the
 * rare case of a token that is not in `TOKENS` yet, not a thing most people
 * ever need, so it should not compete with settings people actually reach for.
 */
function CustomTokensSection() {
  const client = useWallet((state) => state.queryClient)
  const address = useWallet((state) => state.address)
  const tokens = useCustomTokens((state) => state.tokens)
  const addToken = useCustomTokens((state) => state.add)
  const removeToken = useCustomTokens((state) => state.remove)

  const [expanded, setExpanded] = useState(false)
  const [input, setInput] = useState('')
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | undefined>()

  const submit = async () => {
    const contractAddress = input.trim()
    if (!contractAddress) return

    if (tokens.some((token) => token.address === contractAddress)) {
      setError('Already added.')
      return
    }
    if (!client) {
      setError('Connect a wallet first — reading a token needs a query client.')
      return
    }

    setChecking(true)
    setError(undefined)
    try {
      const info = await queryTokenInfo(client, contractAddress)
      addToken({
        symbol: info.symbol,
        description: info.name !== info.symbol ? info.name : undefined,
        address: contractAddress,
        image: 'generic.svg',
        decimals: info.decimals
      })
      // So it shows up without needing a full registry sweep.
      if (address) rememberTokens(address, [contractAddress])
      setInput('')
    } catch (caught) {
      // The node says why — "contract: not found", say — and that is more use
      // than a generic sentence, which is all this could show before, since a
      // secretjs failure is not an Error and fell through to the fallback.
      setError(errorMessage(caught))
    } finally {
      setChecking(false)
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="state-layer flex items-center justify-between rounded-control px-1 py-1 text-left text-sm text-text-faint"
      >
        Add a custom token
        <ChevronDown size={14} aria-hidden className={cn('transition-transform', expanded && 'rotate-180')} />
      </button>

      {expanded ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-text-faint">
            Not every SNIP-20 is in the built-in list. Add one by contract address — its symbol and decimals
            are read from the chain, not typed in.
          </p>

          <div className="flex gap-2">
            <input
              value={input}
              onChange={(event) => {
                setInput(event.target.value)
                setError(undefined)
              }}
              placeholder="secret1…"
              spellCheck={false}
              className="min-w-0 flex-1 rounded-control border border-border bg-surface px-3 py-2 font-mono text-sm outline-none placeholder:text-text-faint"
            />
            <Button variant="soft" shape="control" size="sm" loading={checking} onClick={() => void submit()}>
              Add
            </Button>
          </div>

          {error ? <p className="text-sm text-negative">{error}</p> : null}

          {tokens.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {tokens.map((token) => (
                <li
                  key={token.address}
                  className="flex items-center justify-between gap-3 rounded-control bg-surface px-3 py-2 text-sm"
                >
                  <span className="min-w-0">
                    <span className="block font-medium">{token.symbol}</span>
                    <span className="break-address block text-text-faint">{shortenAddress(token.address)}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => removeToken(token.address)}
                    aria-label={`Remove ${token.symbol}`}
                    className="state-layer shrink-0 rounded-control p-1.5 text-text-faint"
                  >
                    <Trash2 size={14} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

function PermitSection() {
  const { permit, staleTokens, signing, sign, forget } = usePermit()

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-base font-semibold">Query permit</h3>

      {permit ? (
        <>
          <p className="text-sm text-text-muted">
            Signed, covering {permit.params.allowed_tokens.length} tokens
            {staleTokens.length > 0 ? `, ${staleTokens.length} newer than it` : ''}.
          </p>
          <div className="flex gap-2">
            <Button variant="soft" shape="control" size="sm" loading={signing} onClick={() => void sign()}>
              Re-sign
            </Button>
            <Button variant="ghost" size="sm" onClick={forget}>
              Forget on this device
            </Button>
          </div>
          <p className="text-sm text-text-faint">
            Forgetting removes the local copy only. It stays valid on chain until revoked, which is a
            transaction and cannot be undone under the same permit name.
          </p>
        </>
      ) : (
        <>
          <p className="text-sm text-text-muted">Not signed. Private balances cannot be read without it.</p>
          <Button variant="soft" shape="control" size="sm" loading={signing} onClick={() => void sign()}>
            Sign permit
          </Button>
        </>
      )}
    </section>
  )
}

import { ArrowUpRight, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { DISPLAY_DENOM } from '@/chains/secret4'
import { collectTags, fetchDapps, WHERE_TO_BUY, type Dapp } from '@/lib/dapps'
import { cn } from '@/lib/cn'

/** Secret dApps, and where to get SCRT if you have none. */
export default function Ecosystem() {
  const [dapps, setDapps] = useState<Dapp[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>()
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState<string | undefined>()

  useEffect(() => {
    let cancelled = false
    fetchDapps()
      .then((list) => {
        if (!cancelled) setDapps(list)
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const tags = useMemo(() => collectTags(dapps), [dapps])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return dapps.filter((dapp) => {
      if (tag && !dapp.tags.includes(tag)) return false
      if (!needle) return true
      return dapp.name.toLowerCase().includes(needle) || dapp.description.toLowerCase().includes(needle)
    })
  }, [dapps, query, tag])

  return (
    <div className="mx-auto flex max-w-[900px] flex-col gap-8">
      <h1 className="text-display">Ecosystem</h1>

      <section className="flex flex-col gap-4">
        <div className="flex items-center gap-2.5 rounded-control border border-border bg-surface px-3 py-2">
          <Search size={16} aria-hidden className="shrink-0 text-text-muted" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search apps"
            className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-text-faint"
          />
        </div>

        {tags.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            <TagButton active={!tag} onClick={() => setTag(undefined)}>
              All
            </TagButton>
            {tags.map((name) => (
              <TagButton key={name} active={tag === name} onClick={() => setTag(name)}>
                {name}
              </TagButton>
            ))}
          </div>
        ) : null}

        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2" aria-busy>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-24 animate-pulse card" />
            ))}
          </div>
        ) : error ? (
          <p className="card p-4 text-base text-text-muted" role="alert">
            {error} This is the published registry, not something this dashboard maintains, so it may simply
            be unreachable right now.
          </p>
        ) : visible.length === 0 ? (
          <p className="card p-4 text-base text-text-muted">
            Nothing matches. {dapps.length} apps are listed in total.
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {visible.map((dapp) => (
              <li key={dapp.name}>
                <a
                  href={dapp.link}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="state-layer flex h-full gap-3 card p-4"
                >
                  <DappIcon dapp={dapp} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-base font-medium">{dapp.name}</span>
                      <ArrowUpRight size={14} aria-hidden className="shrink-0 text-text-faint" />
                    </span>
                    <span className="mt-0.5 block text-sm text-text-muted">{dapp.description}</span>
                    {dapp.tags.length > 0 ? (
                      <span className="mt-2 block text-xs text-text-faint">{dapp.tags.join(' · ')}</span>
                    ) : null}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-title">Where to get {DISPLAY_DENOM}</h2>
        <ul className="grid gap-3 sm:grid-cols-3">
          {WHERE_TO_BUY.map((place) => {
            const body = (
              <>
                <span className="flex items-center gap-1.5 text-base font-medium">
                  {place.name}
                  {!place.internal ? (
                    <ArrowUpRight size={14} aria-hidden className="shrink-0 text-text-faint" />
                  ) : null}
                </span>
                <span className="mt-1 block text-sm text-text-muted">{place.detail}</span>
              </>
            )

            return (
              <li key={place.name}>
                {place.internal ? (
                  <Link to={place.link} className="state-layer block h-full card p-4">
                    {body}
                  </Link>
                ) : (
                  <a
                    href={place.link}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="state-layer block h-full card p-4"
                  >
                    {body}
                  </a>
                )}
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}

function TagButton({
  active,
  onClick,
  children
}: {
  active: boolean
  onClick: () => void
  children: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'state-layer rounded-pill px-3 py-1.5 text-sm font-medium',
        active ? 'bg-accent-container text-accent' : 'bg-surface text-text-muted'
      )}
    >
      {children}
    </button>
  )
}

/**
 * Icons are the local copies. One the registry has added since this build will
 * 404, so it falls back to a letter rather than a broken-image glyph.
 */
function DappIcon({ dapp }: { dapp: Dapp }) {
  const [failed, setFailed] = useState(false)

  if (!dapp.icon || failed) {
    return (
      <span
        aria-hidden
        className="flex size-10 shrink-0 items-center justify-center rounded-control bg-surface text-base font-semibold text-text-muted"
      >
        {dapp.name.slice(0, 1).toUpperCase()}
      </span>
    )
  }

  return (
    <img
      src={dapp.icon}
      alt=""
      onError={() => setFailed(true)}
      className="size-10 shrink-0 rounded-control object-contain"
    />
  )
}

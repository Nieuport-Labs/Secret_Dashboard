import { ArrowUpRight, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { DISPLAY_DENOM } from '@/chains/secret4'
import { collectTags, featuredDapp, fetchDapps, WHERE_TO_BUY, type Dapp } from '@/lib/dapps'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'

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
        if (!cancelled) setError(errorMessage(caught))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const tags = useMemo(() => collectTags(dapps), [dapps])
  const featured = useMemo(() => featuredDapp(dapps), [dapps])

  const filtering = Boolean(query.trim() || tag)

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return dapps.filter((dapp) => {
      // The featured app has the top of the page to itself while nobody is
      // looking for anything in particular. Once they are, it is an app like
      // any other and belongs in the results — a search for it that came back
      // empty would be a plain bug.
      if (!filtering && dapp.name === featured.name) return false
      if (tag && !dapp.tags.includes(tag)) return false
      if (!needle) return true
      return dapp.name.toLowerCase().includes(needle) || dapp.description.toLowerCase().includes(needle)
    })
  }, [dapps, query, tag, filtering, featured.name])

  return (
    <div className="mx-auto flex max-w-[1180px] flex-col gap-10">
      <h1 className="text-display">Ecosystem</h1>

      {!filtering ? <FeaturedApp dapp={featured} loading={loading} /> : null}

      <section className="flex flex-col gap-5">
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
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy>
            {[0, 1, 2, 3, 4, 5].map((i) => (
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
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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

      <section className="flex flex-col gap-5">
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

/**
 * The one app the page puts its arm around.
 *
 * A promotional slot, and it says so: "Featured" in the corner, so nobody
 * mistakes the top of the page for the most-used app or the one this dashboard
 * endorses hardest. Everything in it — name, description, icon, link — comes
 * from the same registry as the grid below, so it cannot drift out of date on
 * its own.
 *
 * The motion is in CSS (`.featured-surface`), not here: two accent clouds
 * drifting on a twenty-second cycle behind the text, which stops entirely for
 * anyone who has asked for reduced motion.
 */
function FeaturedApp({ dapp, loading }: { dapp: Dapp; loading: boolean }) {
  if (loading) return <div className="h-40 animate-pulse card sm:h-44" aria-busy />

  return (
    <a
      href={dapp.link}
      target="_blank"
      rel="noreferrer noopener"
      className={cn(
        'featured-surface card group flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:gap-7 sm:p-8',
        'transition-transform duration-[var(--duration-medium)] ease-[var(--ease-standard)]',
        'motion-safe:hover:-translate-y-0.5'
      )}
    >
      <DappIcon dapp={dapp} size="lg" />

      <div className="min-w-0 flex-1">
        <p className="text-label font-medium uppercase tracking-[0.12em] text-accent">Featured</p>
        <h2 className="mt-1.5 flex items-center gap-2 text-headline">
          <span className="truncate">{dapp.name}</span>
          <ArrowUpRight
            size={20}
            aria-hidden
            className={cn(
              'shrink-0 text-text-muted',
              'transition-transform duration-[var(--duration-short)] ease-[var(--ease-standard)]',
              'motion-safe:group-hover:translate-x-0.5 motion-safe:group-hover:-translate-y-0.5'
            )}
          />
        </h2>
        <p className="mt-2 max-w-[60ch] text-base text-text-muted">{dapp.description}</p>
        {dapp.tags.length > 0 ? (
          <p className="mt-3 text-label text-text-faint">{dapp.tags.join(' · ')}</p>
        ) : null}
      </div>
    </a>
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
function DappIcon({ dapp, size = 'md' }: { dapp: Dapp; size?: 'md' | 'lg' }) {
  const [failed, setFailed] = useState(false)
  const box = size === 'lg' ? 'size-16 rounded-card sm:size-20' : 'size-10 rounded-control'

  if (!dapp.icon || failed) {
    return (
      <span
        aria-hidden
        className={cn(
          'flex shrink-0 items-center justify-center bg-surface font-semibold text-text-muted',
          box,
          size === 'lg' ? 'text-headline' : 'text-base'
        )}
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
      className={cn('shrink-0 object-contain', box)}
    />
  )
}

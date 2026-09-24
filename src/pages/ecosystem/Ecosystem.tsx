import { ArrowLeftRight, ArrowUpRight, Copy, EyeOff, ReceiptText, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { DISPLAY_DENOM } from '@/chains/secret4'
import { collectTags, DAPPS, FEATURED, WHERE_TO_BUY, type Dapp } from '@/lib/dapps'
import { cn } from '@/lib/cn'

/** Secret dApps, and where to get SCRT if you have none. */
export default function Ecosystem() {
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState<string | undefined>()

  const dapps = DAPPS
  const featured = FEATURED
  const tags = useMemo(() => collectTags(dapps), [dapps])

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

      {!filtering ? <FeaturedApp dapp={featured} /> : null}

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

        {visible.length === 0 ? (
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
 * mistakes the top of the page for the most-used app. Name, description, icon
 * and link come from the same list as the grid below.
 *
 * The right-hand side is a still life of the dashboard itself — a validator,
 * Send and Receive, drawn as inert miniatures rather than the real panels,
 * which would need a wallet to render. They fan out from one another as the
 * card appears and a little further on hover; the motion lives in CSS
 * (`.featured-window`) and reduced motion leaves them already fanned out.
 */
function FeaturedApp({ dapp }: { dapp: Dapp }) {
  return (
    <a
      href={dapp.link}
      target="_blank"
      rel="noreferrer noopener"
      className="featured-surface card group relative flex flex-col sm:h-52 sm:flex-row sm:items-center"
    >
      <div className="relative z-10 flex min-w-0 items-center gap-5 p-6 sm:w-[50%] sm:shrink-0 sm:p-7">
        <DappIcon dapp={dapp} size="lg" />

        <div className="min-w-0">
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
          <p className="mt-1.5 line-clamp-2 max-w-[48ch] text-base text-text-muted">{dapp.description}</p>
          {dapp.tags.length > 0 ? (
            <p className="mt-2 text-label text-text-faint">{dapp.tags.join(' · ')}</p>
          ) : null}
        </div>
      </div>

      <div aria-hidden className="featured-stage relative h-44 shrink-0 sm:h-auto sm:min-w-0 sm:flex-1 sm:self-stretch">
        <ValidatorWindow />
        <SendWindow />
        <ReceiveWindow />
      </div>
    </a>
  )
}

/** Grey bars standing in for text the miniature does not need to say. */
function Lines({ widths }: { widths: string[] }) {
  return (
    <span className="flex flex-col gap-1.5">
      {widths.map((width, i) => (
        <span key={i} className="block h-1.5 rounded-pill bg-surface-3" style={{ width }} />
      ))}
    </span>
  )
}

function ValidatorWindow() {
  return (
    <span className="featured-window featured-window--a">
      <span className="flex items-center gap-2.5">
        <span className="size-8 shrink-0 rounded-pill bg-accent-container" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">Validator</span>
          <span className="block truncate text-[11px] text-text-muted">5.0% commission · 5.4% voting power</span>
        </span>
        <X size={12} className="shrink-0 text-text-faint" />
      </span>
      <span className="mt-4 block">
        <Lines widths={['95%', '88%', '70%', '52%']} />
      </span>
      <span className="mt-4 flex gap-2">
        <span className="flex-1 rounded-control bg-accent-container py-1.5 text-center text-xs font-medium text-accent">
          Stake
        </span>
        <span className="flex-1 rounded-control bg-surface-2 py-1.5 text-center text-xs font-medium text-text-muted">
          Unstake
        </span>
      </span>
      <span className="mt-3 block text-[11px] text-text-muted">Amount</span>
      <span className="mt-1 block rounded-control bg-surface-2 px-2.5 py-1.5 text-xs text-text-faint">0.0</span>
    </span>
  )
}

function SendWindow() {
  return (
    <span className="featured-window featured-window--b">
      <span className="block text-base font-semibold">Send</span>
      <span className="mt-3 block rounded-control bg-surface-2 p-3">
        <span className="block text-[11px] text-text-muted">You&rsquo;re sending</span>
        <span className="mt-2 block text-right text-3xl font-semibold text-text-muted">0</span>
        <span className="mt-1 block text-right text-[11px] text-text-faint">SCRT</span>
      </span>
      <span className="mt-3 flex justify-end gap-1.5">
        {['25%', '50%', 'Max'].map((label) => (
          <span key={label} className="rounded-pill border border-border px-2 py-0.5 text-[10px] text-text-muted">
            {label}
          </span>
        ))}
      </span>
      <span className="mt-3 block">
        <Lines widths={['80%', '60%']} />
      </span>
    </span>
  )
}

function ReceiveWindow() {
  return (
    <span className="featured-window featured-window--c">
      <span className="flex items-center justify-between">
        <span className="text-base font-semibold">Receive</span>
        <X size={12} className="text-text-faint" />
      </span>
      <span className="mt-3 flex gap-3">
        <span className="flex size-24 shrink-0 items-center justify-center gap-1 rounded-control bg-surface-2 text-[11px] text-text-muted">
          <EyeOff size={12} />
          Hidden
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] text-text-muted">Your address</span>
          <span className="mt-1 block truncate font-mono text-[11px]">secret1••••••…••••</span>
          <span className="mt-2 inline-flex items-center gap-1 rounded-control bg-surface-2 px-2 py-1 text-[11px] font-medium">
            <Copy size={11} />
            Copy address
          </span>
          <span className="mt-2 block">
            <Lines widths={['100%', '85%']} />
          </span>
        </span>
      </span>
      <span className="mt-3 flex gap-2">
        <span className="flex flex-1 items-center justify-center gap-1.5 rounded-pill bg-surface-2 py-1.5 text-[11px] font-medium">
          <ArrowLeftRight size={11} />
          Bridge in
        </span>
        <span className="flex flex-1 items-center justify-center gap-1.5 rounded-pill bg-accent py-1.5 text-[11px] font-medium text-accent-text">
          <ReceiptText size={11} />
          Create invoice
        </span>
      </span>
    </span>
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

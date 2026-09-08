import { next } from '@vercel/edge'

// Vercel's own middleware bundler type-checks under `moduleResolution:
// nodenext`, which — unlike this repo's own `bundler` resolution — requires
// the extension a relative ESM import will actually resolve to at runtime.
import { isValidBech32 } from './src/lib/bech32.js'

/**
 * Gives link-preview bots a real title, description and image per URL — a
 * proposal names itself, a profile shows the address it belongs to — on top
 * of a Vite SPA that otherwise serves the same static `index.html` for every
 * route.
 *
 * A crawler never runs the app's JS, so nothing set from React (the tab title
 * `Profile.tsx` sets, say) is visible to it; the only lever left is rewriting
 * the HTML response itself before it leaves the edge. `api/og.tsx` renders the
 * image this points at; this file only decides which one.
 *
 * Gated to requests carrying a known crawler's user agent. Every real visitor
 * — the overwhelming majority — gets the static file straight through with
 * none of this: no origin-proposal fetch, no extra round trip. Bots are also
 * not latency-sensitive the way a person clicking a link is, so the one LCD
 * query this sometimes makes is a cost only they pay.
 */

export const config = {
  // Anything that is not the API, a static asset, or index.html itself —
  // fetching index.html from inside this function must not re-enter it.
  matcher: ['/((?!api/|assets/|img/|fonts/|favicon\\.svg|index\\.html).*)']
}

const BOT_UA =
  /facebookexternalhit|Facebot|Twitterbot|Slackbot|Discordbot|TelegramBot|LinkedInBot|WhatsApp|SkypeUriPreview|Applebot|Googlebot|bingbot|Pinterest|redditbot|vkShare|Iframely|Embedly|Google-InspectionTool|Google-PageRenderer|W3C_Validator/i

const SITE_TITLE = 'Secret Dashboard'
const SITE_DESCRIPTION =
  'An entry point into Secret Network — wallet, bridge, staking and the Secret dApp ecosystem.'

/** One line per section, for the routes worth naming individually. */
const PAGE_META: Record<string, { title: string; description: string }> = {
  wallet: { title: 'Wallet', description: 'Balances, send, receive and bridge on Secret Network.' },
  staking: {
    title: 'Staking',
    description: 'Delegate SCRT to validators and manage rewards on Secret Network.'
  },
  governance: {
    title: 'Governance',
    description: 'Vote on live proposals and browse the history of Secret Network governance.'
  },
  bridge: { title: 'Bridge', description: 'Move assets in and out of Secret Network over IBC.' },
  ecosystem: { title: 'Ecosystem', description: 'Apps built on Secret Network.' },
  network: {
    title: 'Network',
    description: 'Validators, chain parameters and network health for Secret Network.'
  },
  powertools: { title: 'Powertools', description: 'Advanced utilities for Secret Network power users.' }
}

/** Mirrors `STATUS_LABELS` in `src/lib/governance.ts`. */
const STATUS_LABELS: Record<string, string> = {
  PROPOSAL_STATUS_UNSPECIFIED: 'Unknown',
  PROPOSAL_STATUS_DEPOSIT_PERIOD: 'Deposit',
  PROPOSAL_STATUS_VOTING_PERIOD: 'Voting',
  PROPOSAL_STATUS_PASSED: 'Passed',
  PROPOSAL_STATUS_REJECTED: 'Rejected',
  PROPOSAL_STATUS_FAILED: 'Failed'
}

/** Same candidates as `chains/secret4.ts`'s `DEFAULT_LCD_URLS`, copied for the
 * same reason every other constant here is copied — this bundles separately
 * from the app and cannot import across the `@/` alias. */
const LCD_URLS = [
  'https://lcd-secret.keplr.app',
  'https://rest.lavenderfive.com:443/secretnetwork',
  'https://secretnetwork-api.lavenderfive.com'
]

interface ProposalMeta {
  title: string
  status: string
  expedited: boolean
  votingStart?: string
  votingEnd?: string
}

async function fetchProposal(id: string): Promise<ProposalMeta | undefined> {
  for (const base of LCD_URLS) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2000)
    try {
      const res = await fetch(`${base}/cosmos/gov/v1/proposals/${id}`, { signal: controller.signal })
      if (!res.ok) continue
      const data = (await res.json()) as { proposal?: Record<string, unknown> }
      const proposal = data.proposal
      if (!proposal) continue
      return {
        title: String(proposal.title ?? `Proposal #${id}`),
        status: String(proposal.status ?? 'PROPOSAL_STATUS_UNSPECIFIED'),
        expedited: Boolean(proposal.expedited),
        votingStart: typeof proposal.voting_start_time === 'string' ? proposal.voting_start_time : undefined,
        votingEnd: typeof proposal.voting_end_time === 'string' ? proposal.voting_end_time : undefined
      }
    } catch {
      continue
    } finally {
      clearTimeout(timeout)
    }
  }
  return undefined
}

function shorten(address: string, head = 10, tail = 6): string {
  return address.length <= head + tail + 1 ? address : `${address.slice(0, head)}…${address.slice(-tail)}`
}

interface Meta {
  title: string
  description: string
  url: string
  image: string
}

async function resolveMeta(url: URL): Promise<Meta> {
  const origin = url.origin
  const segments = url.pathname.split('/').filter(Boolean)

  if (segments[0] === 'governance' && segments[1] && /^\d+$/.test(segments[1])) {
    const id = segments[1]
    const proposal = await fetchProposal(id)
    if (proposal) {
      const statusLabel = STATUS_LABELS[proposal.status] ?? 'Unknown'
      const dates =
        proposal.votingStart && proposal.votingEnd
          ? `&start=${encodeURIComponent(proposal.votingStart)}&end=${encodeURIComponent(proposal.votingEnd)}`
          : ''
      return {
        title: `#${id} · ${proposal.title} · Secret Dashboard`,
        description: `${statusLabel}${proposal.expedited ? ' · expedited' : ''} — Secret Network governance proposal #${id}. Read the full text and vote on Secret Dashboard.`,
        url: `${origin}/governance/${id}`,
        image: `${origin}/api/og?kind=proposal&id=${encodeURIComponent(id)}&title=${encodeURIComponent(proposal.title)}&status=${encodeURIComponent(proposal.status)}${dates}`
      }
    }
    // Fetch failed or the id does not exist — fall through to the generic
    // governance card rather than serving a broken one.
  }

  if (segments.length === 1 && segments[0].startsWith('secret1') && isValidBech32(segments[0], 'secret')) {
    const address = segments[0]
    return {
      title: `${shorten(address)} · Secret Dashboard`,
      description:
        'Send SCRT or a private token on Secret Network. This page shows only the address — nothing about what is held there.',
      url: `${origin}/${address}`,
      image: `${origin}/api/og?kind=profile&address=${encodeURIComponent(address)}`
    }
  }

  const page = PAGE_META[segments[0] ?? '']
  return {
    title: page ? `${page.title} · Secret Dashboard` : SITE_TITLE,
    description: page ? page.description : SITE_DESCRIPTION,
    url: origin + url.pathname,
    image: `${origin}/api/og`
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export default async function middleware(request: Request) {
  const userAgent = request.headers.get('user-agent') ?? ''
  if (!BOT_UA.test(userAgent)) return next()

  const url = new URL(request.url)
  const meta = await resolveMeta(url)

  const origin = await fetch(new URL('/index.html', url), { headers: { accept: 'text/html' } })
  if (!origin.ok) return next()
  const html = await origin.text()

  const title = escapeHtml(meta.title)
  const description = escapeHtml(meta.description)
  const pageUrl = escapeHtml(meta.url)
  const image = escapeHtml(meta.image)

  const rewritten = html
    .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
    .replace(/<!--OG:START-->[\s\S]*?<!--OG:END-->/, () =>
      [
        '<!--OG:START-->',
        `<meta property="og:type" content="website" />`,
        `<meta property="og:site_name" content="${escapeHtml(SITE_TITLE)}" />`,
        `<meta property="og:url" content="${pageUrl}" />`,
        `<meta property="og:title" content="${title}" />`,
        `<meta property="og:description" content="${description}" />`,
        `<meta property="og:image" content="${image}" />`,
        `<meta property="og:image:width" content="1200" />`,
        `<meta property="og:image:height" content="630" />`,
        `<meta name="twitter:card" content="summary_large_image" />`,
        `<meta name="twitter:title" content="${title}" />`,
        `<meta name="twitter:description" content="${description}" />`,
        `<meta name="twitter:image" content="${image}" />`,
        '<!--OG:END-->'
      ].join('\n    ')
    )

  return new Response(rewritten, {
    status: origin.status,
    headers: { 'content-type': 'text/html; charset=utf-8' }
  })
}

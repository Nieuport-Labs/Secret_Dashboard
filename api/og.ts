import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Resvg } from '@resvg/resvg-js'

/**
 * Renders the PNG behind every `og:image` and `twitter:image` in the app.
 *
 * A link card is the one place this dashboard has no control over layout —
 * Slack, Discord and Twitter all draw their own frame around whatever image
 * this returns — so the job here is just to make that frame worth having:
 * the same dark ground and accent orange as the app itself, so a shared link
 * reads as *this* dashboard before anyone has clicked it.
 *
 * `middleware.ts` is what points a given URL at a particular set of query
 * params; this file only knows how to turn params into pixels; it has no idea
 * which page asked for them.
 *
 * Plain SVG, built by hand, rendered to PNG by `@resvg/resvg-js` — not
 * `@vercel/og`, and not `satori` either, which is what `@vercel/og` itself
 * renders through. Both were tried first and both turned out to depend on
 * `harfbuzzjs` for text shaping, which does a conditional `require("fs")`
 * to load its own `.wasm` binary relative to `__dirname` — a reference
 * Vercel's edge bundler flags and refuses regardless of whether the branch
 * that touches it would ever run there, and which behaved unreliably even
 * on the Node runtime, where `fs` is allowed. A card this simple — one or
 * two lines of Latin text, a handful of shapes — has no real use for
 * harfbuzz's complex-script shaping in the first place, so this writes the
 * SVG directly instead of asking a flexbox-layout engine to produce one.
 * `@resvg/resvg-js` alone has none of that: a native binding, not a wasm
 * module, with no dynamic `require` to trip over. It is Node-only as a
 * result — not a meaningful cost, since a link-preview bot's one request
 * per share is not latency-sensitive the way `middleware.ts` treats a real
 * visitor's page load.
 *
 * The trade against `satori` is real, not just packaging: no automatic text
 * wrapping. Long titles are truncated to a single line (see `MAX_TITLE`)
 * rather than flowed across two, which satori's flexbox layout could do
 * without knowing the font's metrics in advance — this doesn't, so it
 * settles for shorter instead of guessing where a line would break.
 *
 * Self-contained otherwise. This bundles by itself, separately from Vite —
 * the `@/` path aliases the rest of the app uses do not resolve here, so the
 * handful of constants this needs (status colours, the hue formula) are
 * copied rather than imported. They are small and stable; see
 * `src/lib/governance.ts` and `src/lib/identicon.ts` for the source of truth
 * if either ever drifts.
 */

const WIDTH = 1200
const HEIGHT = 630
const PAD = 72

const BG = '#080808'
const TEXT = '#ffffff'
const TEXT_MUTED = 'rgba(255,255,255,0.62)'
const TEXT_FAINT = 'rgba(255,255,255,0.4)'
const BORDER = 'rgba(255,255,255,0.08)'
const ACCENT = '#ff3912'

/** The title's font size, and a character budget conservative enough that
 * even an all-caps, wide-glyph title fits in one line at that size within
 * the canvas — there is no text measurement here to check with. */
const TITLE_FONT_SIZE = 52
const MAX_TITLE = 36

/** Mirrors `STATUS_LABELS` and the tone table in `StatusBadge.tsx`. */
const STATUS: Record<string, { label: string; color: string }> = {
  PROPOSAL_STATUS_UNSPECIFIED: { label: 'Unknown', color: '#8b93a3' },
  PROPOSAL_STATUS_DEPOSIT_PERIOD: { label: 'Deposit', color: '#4f8fe8' },
  PROPOSAL_STATUS_VOTING_PERIOD: { label: 'Voting', color: ACCENT },
  PROPOSAL_STATUS_PASSED: { label: 'Passed', color: '#21c17a' },
  PROPOSAL_STATUS_REJECTED: { label: 'Rejected', color: '#ff4d4d' },
  PROPOSAL_STATUS_FAILED: { label: 'Failed', color: '#8b93a3' }
}

/** The dashboard's own diamond mark, traced from `public/img/logo-mark.svg`. */
const LOGO_PATH =
  'M29.9149 47.2305C28.7797 47.9222 27.6738 48.6146 26.5507 49.2764C24.9211 50.2366 23.2681 50.249 21.6495 49.2668C16.1541 45.932 10.6684 42.5804 5.17895 39.2351C3.83869 38.4184 2.50172 37.5959 1.15709 36.7867C0.37236 36.3145 -0.00857132 35.6318 0.00539978 34.6968C0.0211914 33.6398 0.0130082 32.5823 0.00781957 31.5251C0.00351715 30.6485 0.37047 29.9917 1.10235 29.5454C3.42796 28.1274 5.75424 26.7105 8.08059 25.2938C8.4914 25.0436 8.49501 24.9684 8.08463 24.7179C5.81906 23.3348 3.55978 21.9407 1.28211 20.5787C0.400394 20.0515 -0.0325568 19.3282 0.00190675 18.2751C0.0349312 17.266 0.0133886 16.2549 0.00774493 15.2447C0.00277188 14.3547 0.375707 13.6963 1.12202 13.2419C5.90262 10.3307 10.6811 7.41576 15.4604 4.50238C17.5298 3.2409 19.5916 1.96589 21.672 0.723647C23.2972 -0.246807 24.9527 -0.241749 26.5711 0.742235C33.415 4.90303 40.2513 9.07676 47.0926 13.2419C47.8415 13.6978 48.2087 14.3598 48.2079 15.2452C48.207 16.2672 48.188 17.2897 48.2132 18.3111C48.2384 19.3327 47.8149 20.0481 46.9598 20.5616C44.6847 21.928 42.4232 23.3182 40.1573 24.7005C39.701 24.9789 39.7047 25.0305 40.163 25.3097C42.4692 26.7148 44.773 28.1239 47.0811 29.5257C47.8404 29.9869 48.2133 30.6579 48.2089 31.5597C48.2037 32.6286 48.2061 33.6977 48.2082 34.7666C48.2099 35.6406 47.8461 36.3037 47.1141 36.7499C41.6447 40.0834 36.1744 43.4152 30.7044 46.7476C30.4481 46.9037 30.1925 47.0608 29.9149 47.2305ZM15.5613 39.8664C17.868 41.2706 20.1815 42.6632 22.4784 44.0841C23.5713 44.7601 24.6213 44.7653 25.7175 44.0946C30.8562 40.9505 36.003 37.8203 41.1469 34.685C41.8663 34.2466 42.5877 33.8114 43.3038 33.3674C43.5588 33.2093 43.5552 33.103 43.3133 32.9344C43.2565 32.8948 43.196 32.8608 43.1369 32.8248C39.303 30.4894 35.4696 28.1532 31.6329 25.8225C31.5162 25.7517 31.3044 25.665 31.2446 25.7165C31.1462 25.8012 31.0956 25.9931 31.0953 26.1399C31.0935 27.0322 31.1176 27.9244 31.1213 28.8168C31.125 29.7209 30.7671 30.4231 29.9928 30.8916C28.8672 31.5727 27.7503 32.269 26.6223 32.9458C24.9245 33.9645 23.2272 33.9441 21.5372 32.9155C17.5941 30.5154 13.6503 28.1164 9.70607 25.7182C9.33997 25.4956 9.2182 25.5698 9.21706 26.0143C9.21461 26.9775 9.21666 27.9407 9.21611 28.9039C9.21558 29.8392 8.83537 30.5456 8.03531 31.0224C7.00455 31.6366 5.98373 32.2684 4.96108 32.8968C4.63247 33.0987 4.63694 33.1907 4.96619 33.4037C5.02437 33.4413 5.08249 33.4791 5.14162 33.5151C8.60087 35.6227 12.0602 37.7301 15.5613 39.8664ZM38.6332 13.7915C34.2589 11.1236 29.8886 8.44884 25.5072 5.79329C24.5599 5.21915 23.5783 5.25976 22.6299 5.83554C20.736 6.98543 18.8456 8.14138 16.9536 9.29452C12.9725 11.7209 8.99112 14.1467 5.0105 16.5737C4.60097 16.8234 4.60422 16.8901 5.02544 17.1473C5.58681 17.4902 6.1488 17.832 6.71051 18.1743C10.002 20.18 13.2929 22.1865 16.5868 24.188C16.7068 24.2609 16.8554 24.2843 16.9906 24.3308C17.0234 24.1905 17.0834 24.0505 17.0845 23.91C17.0914 22.9704 17.0863 22.0307 17.084 21.0911C17.0819 20.2434 17.4421 19.5982 18.1444 19.1635C19.3221 18.4346 20.4977 17.7012 21.6927 17.0028C23.2999 16.0637 24.9374 16.0515 26.5333 17.0135C30.4664 19.3842 34.384 21.7818 38.3114 24.1624C38.468 24.2574 38.6611 24.2894 38.8371 24.3507C38.8834 24.1679 38.9667 23.9857 38.9697 23.8021C38.984 22.9449 39.0002 22.0864 38.9699 21.2301C38.9332 20.1935 39.3519 19.4573 40.2255 18.947C41.1815 18.3886 42.1191 17.7972 43.0657 17.2219C43.6471 16.8685 43.6492 16.8438 43.0834 16.4987C41.6153 15.6035 40.1466 14.7092 38.6332 13.7915ZM19.0203 25.6803C20.2118 26.4059 21.4034 27.1312 22.5947 27.857C23.6032 28.4714 24.6101 28.472 25.6193 27.8561C27.0659 26.9732 28.5145 26.0936 29.9616 25.2115C30.0617 25.1505 30.1565 25.0805 30.287 24.9922C28.6197 23.9769 27.0201 22.967 25.3849 22.0216C24.5057 21.5134 23.5714 21.5687 22.6928 22.0908C21.5831 22.7503 20.4849 23.4303 19.3826 24.103C18.9085 24.3923 18.4365 24.6854 17.9188 25.0043C18.3125 25.2455 18.6451 25.4492 19.0203 25.6803Z'

/** Deterministic hue from a string — identical formula to `lib/identicon.ts`. */
function hueFor(seed: string): number {
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) % 360
  return hash
}

function shorten(address: string, head = 10, tail = 6): string {
  return address.length <= head + tail + 1 ? address : `${address.slice(0, head)}…${address.slice(-tail)}`
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * A font file resvg can point at by path — `@resvg/resvg-js` only accepts
 * fonts as local files or system fonts, not raw buffers, so the bytes this
 * fetches have to land on disk before the render call. `/tmp` is writable
 * and, on a warm instance, already has the file from the previous request.
 */
async function ensureFont(weight: 400 | 700): Promise<string> {
  const path = join(tmpdir(), `secret-dashboard-inter-${weight}.ttf`)
  const css = await fetch(`https://fonts.googleapis.com/css2?family=Inter:wght@${weight}`, {
    headers: {
      // A UA old enough that Google's CSS API replies with `.ttf` sources —
      // resvg-js needs a real font file, and it cannot parse `.woff2`.
      'user-agent':
        'Mozilla/5.0 (Windows NT 6.1) AppleWebKit/534.34 (KHTML, like Gecko) PhantomJS/1.9.7 Safari/534.34'
    }
  }).then((res) => res.text())

  const match = /src: url\(([^)]+)\) format\('(?:opentype|truetype)'\)/.exec(css)
  if (!match) throw new Error('Google Fonts did not return a usable font URL')
  const bytes = await fetch(match[1]).then((res) => res.arrayBuffer())
  writeFileSync(path, Buffer.from(bytes))
  return path
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const kind = url.searchParams.get('kind') ?? 'site'

  const [regularPath, boldPath] = await Promise.all([ensureFont(400), ensureFont(700)])

  let eyebrow: { label: string; color: string } | undefined
  let title: string
  let subtitle: string
  let avatar: { initial: string; hue: number } | undefined

  if (kind === 'proposal') {
    const id = url.searchParams.get('id') ?? ''
    const statusKey = url.searchParams.get('status') ?? 'PROPOSAL_STATUS_UNSPECIFIED'
    const status = STATUS[statusKey] ?? STATUS.PROPOSAL_STATUS_UNSPECIFIED
    const rawTitle = url.searchParams.get('title') ?? `Proposal #${id}`
    title = truncate(rawTitle, MAX_TITLE)
    eyebrow = { label: id ? `#${id} · ${status.label}` : status.label, color: status.color }
    subtitle = 'Secret Network governance'
  } else if (kind === 'profile') {
    const address = url.searchParams.get('address') ?? ''
    title = shorten(address, 14, 8)
    subtitle = 'Send SCRT or a private token on Secret Network'
    avatar = { initial: address.slice(7, 8).toUpperCase() || '?', hue: hueFor(address) }
  } else {
    title = 'Secret Dashboard'
    subtitle = 'Wallet, bridge, staking and the Secret dApp ecosystem'
  }

  // Vertical anchors for the content block. Fixed rather than computed —
  // there are only three layouts (site, proposal, profile) and each reads
  // fine at these numbers on a 630px canvas; no layout engine needed for
  // three fixed cases.
  const titleY = eyebrow || avatar ? 348 : 336
  const subtitleY = titleY + 42

  const eyebrowSvg = eyebrow
    ? (() => {
        const width = 40 + eyebrow.label.length * 16
        return `<rect x="${PAD}" y="266" width="${width}" height="44" rx="22" fill="${eyebrow.color}" fill-opacity="0.16" />
       <text x="${PAD + width / 2}" y="294" text-anchor="middle" font-family="Inter" font-weight="700" font-size="22" fill="${eyebrow.color}">${escapeXml(eyebrow.label)}</text>`
      })()
    : ''

  const avatarSvg = avatar
    ? `<defs>
         <linearGradient id="avatar" x1="0" y1="0" x2="1" y2="1">
           <stop offset="0%" stop-color="hsl(${avatar.hue}, 62%, 38%)" />
           <stop offset="100%" stop-color="hsl(${(avatar.hue + 40) % 360}, 58%, 22%)" />
         </linearGradient>
       </defs>
       <circle cx="${PAD + 48}" cy="264" r="48" fill="url(#avatar)" />
       <text x="${PAD + 48}" y="280" text-anchor="middle" font-family="Inter" font-weight="700" font-size="42" fill="${TEXT}">${escapeXml(avatar.initial)}</text>`
    : ''

  const svg = `<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="glow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="${ACCENT}" stop-opacity="0.2" />
        <stop offset="100%" stop-color="${ACCENT}" stop-opacity="0" />
      </radialGradient>
    </defs>

    <rect width="${WIDTH}" height="${HEIGHT}" fill="${BG}" />
    <circle cx="${WIDTH - 220}" cy="-260" r="320" fill="url(#glow)" />

    <g transform="translate(${PAD}, ${PAD})">
      <path d="${LOGO_PATH}" fill="${ACCENT}" transform="scale(0.7)" />
      <text x="50" y="26" font-family="Inter" font-weight="700" font-size="26" fill="${TEXT}">Secret Dashboard</text>
    </g>

    ${eyebrowSvg}
    ${avatarSvg}

    <text x="${PAD}" y="${titleY}" font-family="Inter" font-weight="700" font-size="${TITLE_FONT_SIZE}" fill="${TEXT}">${escapeXml(title)}</text>
    <text x="${PAD}" y="${subtitleY}" font-family="Inter" font-weight="400" font-size="26" fill="${TEXT_MUTED}">${escapeXml(subtitle)}</text>

    <line x1="${PAD}" y1="${HEIGHT - PAD - 30}" x2="${WIDTH - PAD}" y2="${HEIGHT - PAD - 30}" stroke="${BORDER}" stroke-width="1" />
    <text x="${PAD}" y="${HEIGHT - PAD}" font-family="Inter" font-weight="400" font-size="20" fill="${TEXT_FAINT}">${escapeXml(url.hostname)}</text>
    <text x="${WIDTH - PAD}" y="${HEIGHT - PAD}" text-anchor="end" font-family="Inter" font-weight="400" font-size="20" fill="${TEXT_FAINT}">Secret Network</text>
  </svg>`

  const png = new Resvg(svg, {
    font: {
      loadSystemFonts: false,
      fontFiles: [regularPath, boldPath],
      defaultFontFamily: 'Inter'
    }
  })
    .render()
    .asPng()

  return new Response(new Uint8Array(png), {
    headers: {
      'content-type': 'image/png',
      // A share's card is drawn once and then linked from everywhere that
      // share reaches — safe to cache hard rather than re-rendering on
      // every crawler hit.
      'cache-control': 'public, max-age=86400, immutable'
    }
  })
}

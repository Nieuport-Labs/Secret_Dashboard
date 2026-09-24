import { Check, ChevronDown, Clock, Copy, ExternalLink, Loader2, Trash2 } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useState, type ReactNode } from 'react'

import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { explorerTxUrl } from '@/chains/secret4'
import { cn } from '@/lib/cn'
import { shortenAddress } from '@/lib/format'
import { LIMITS, LINK_KINDS } from '@/lib/profile'
import { profileUrl } from '@/lib/profileLink'
import { useOwnProfile } from '@/hooks/useOwnProfile'

interface Props {
  open: boolean
  onClose: () => void
  address: string
}

/**
 * The profile editor: everything this account publishes about itself.
 *
 * Saving is free — the wallet signs the profile, the server keeps the signed
 * copy — and the chain catches up with the account's next transaction
 * (`lib/sendTx.ts`). So an account with no gas still gets a profile, and the
 * dialog says plainly when it is waiting to be written.
 *
 * A dialog rather than a page because it is reached from the account chip in
 * the header, which is on every screen — sending someone to a settings route to
 * change their name and then leaving them there is how an edit becomes a
 * detour. It is also where the shareable link now lives, having been moved out
 * of Receive: the link is about who you are, Receive is about being paid, and
 * having the link in both places meant neither was where people looked.
 *
 * Every field here is public, and each one carries a badge saying so rather
 * than assuming it is obvious. On a chain whose entire premise is that balances
 * are nobody's business, a form that quietly publishes a name would be a
 * betrayal of the only expectation the user arrived with.
 */
export default function ProfileModal({ open, onClose, address }: Props) {
  const { draft, update, revert, save, clear, writeNow, loading, state, dirty, published, pending, onchain } =
    useOwnProfile()

  const [copied, setCopied] = useState(false)
  const [linksOpen, setLinksOpen] = useState(false)

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(profileUrl(address))
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // Refused clipboard access is not worth an error; the link is on screen.
    }
  }

  /**
   * Rebuilt in the order `LINK_KINDS` declares, not in the order rows were
   * typed, so the profile page shows the same sequence every time. Kinds this
   * client does not know about are carried through untouched rather than
   * dropped — an older tab must not silently delete a link a newer one added.
   */
  const setLink = (kind: string, value: string) => {
    const known = new Set(LINK_KINDS.map((candidate) => candidate.kind as string))
    const values = new Map(draft.links.map((link) => [link.kind, link.value]))
    values.set(kind, value)

    update({
      links: [
        ...LINK_KINDS.map((candidate) => ({
          kind: candidate.kind as string,
          value: values.get(candidate.kind) ?? ''
        })).filter((link) => link.value.trim() !== ''),
        ...draft.links.filter((link) => !known.has(link.kind))
      ]
    })
  }

  const valueFor = (kind: string) => draft.links.find((link) => link.kind === kind)?.value ?? ''

  const saving = state.kind === 'sending'
  const filledLinks = LINK_KINDS.filter((kind) => valueFor(kind.kind).trim() !== '')

  return (
    <Modal open={open} onClose={onClose} title="Profile" size="xl">
      {/*
        Two columns once there is room for them: the code and link that hand
        the page out on the left, what it says about you on the right.
        One column on a phone, in the same order.
      */}
      <div className="grid gap-5 md:grid-cols-[240px_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          {/*
            The picture is edited on the wallet page only. Here the space goes
            to the thing this dialog is for handing out: a code that opens the
            public page. On white whatever the theme — scanners need the light
            modules lighter than the dark ones. Not masked by privacy mode, for
            the same reason the link beneath it is not.
          */}
          <div className="w-full rounded-card bg-white p-3">
            <QRCodeSVG
              value={profileUrl(address)}
              size={300}
              level="M"
              bgColor="#ffffff"
              fgColor="#000000"
              className="h-auto w-full"
              title={`Profile link for ${address}`}
            />
          </div>

          {/*
            Moved here from Receive. It belongs with the things that decide what
            the page it opens will say — a link is worth sharing in proportion
            to what is behind it, and that is edited right beside it.
          */}
          <div className="flex flex-col gap-2 rounded-card border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <span className="text-label text-text-muted">Your public link</span>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => void copyLink()}
                  className="state-layer flex items-center gap-1.5 rounded-control px-2 py-1 text-base text-text-muted"
                >
                  {copied ? (
                    <Check size={16} aria-hidden className="text-positive" />
                  ) : (
                    <Copy size={16} aria-hidden />
                  )}
                  {copied ? 'Copied' : 'Copy'}
                </button>
                <a
                  href={profileUrl(address)}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="state-layer flex items-center gap-1.5 rounded-control px-2 py-1 text-base text-text-muted"
                >
                  <ExternalLink size={16} aria-hidden />
                  Open
                </a>
              </div>
            </div>
            {/* Not masked by privacy mode: the owner is looking at their own link in
                order to hand it out, and a redacted string cannot be checked. */}
            <p className="break-address font-mono text-sm text-text-faint">{profileUrl(address)}</p>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <Field label="Name" hint={`${draft.name.length}/${LIMITS.name}`}>
            <input
              value={draft.name}
              onChange={(event) => update({ name: event.target.value.slice(0, LIMITS.name) })}
              placeholder={shortenAddress(address)}
              className={INPUT}
            />
          </Field>

          <Field label="Bio" hint={`${draft.bio.length}/${LIMITS.bio}`}>
            <textarea
              value={draft.bio}
              onChange={(event) => update({ bio: event.target.value.slice(0, LIMITS.bio) })}
              rows={3}
              placeholder="A line about you."
              className={cn(INPUT, 'resize-none')}
            />
          </Field>

          {/*
            Collapsed by default: five rows of mostly-empty handles would
            otherwise be the bulk of the form. The header says which are
            filled, so nothing set is hidden without a trace.
          */}
          <div className="rounded-card border border-border">
            <button
              type="button"
              onClick={() => setLinksOpen((current) => !current)}
              aria-expanded={linksOpen}
              aria-controls="profile-links"
              className="state-layer flex w-full items-center justify-between gap-3 rounded-card px-3 py-2.5 text-left"
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="flex items-center gap-2 text-sm text-text-muted">
                  Social links
                  <span className="rounded-pill border border-border px-1.5 py-px text-label text-text-faint">
                    Public
                  </span>
                </span>
                <span className="truncate text-label text-text-faint">
                  {filledLinks.length === 0
                    ? 'None added'
                    : filledLinks.map((kind) => kind.label).join(' · ')}
                </span>
              </span>
              <ChevronDown
                size={16}
                aria-hidden
                className={cn(
                  'shrink-0 text-text-muted transition-transform duration-short',
                  linksOpen && 'rotate-180'
                )}
              />
            </button>

            {linksOpen ? (
              <div id="profile-links" className="grid gap-3 px-3 pb-3 pt-1 sm:grid-cols-2">
                {LINK_KINDS.map((kind) => (
                  <Field key={kind.kind} label={kind.label}>
                    <input
                      value={valueFor(kind.kind)}
                      onChange={(event) => setLink(kind.kind, event.target.value.slice(0, LIMITS.linkValue))}
                      placeholder={kind.placeholder}
                      spellCheck={false}
                      className={INPUT}
                    />
                  </Field>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2.5">
        {pending && !dirty ? (
          <div
            className="flex items-start gap-2.5 rounded-card border border-border bg-surface p-3"
            role="status"
          >
            <Clock size={16} aria-hidden className="mt-0.5 shrink-0 text-text-muted" />
            <div className="flex flex-col gap-2 text-sm text-text-muted">
              <p>
                {onchain
                  ? 'Published, not on chain yet. It will be written along with your next transaction, at no extra step.'
                  : 'Published, not on chain yet. The profile registry is not live on this network, so it will be written with your first transaction after it is.'}
              </p>
              <p className="text-text-faint">
                Until then, the copy your wallet signed is kept by this dashboard's server, which can see
                which addresses have a profile. On chain, nobody can list them.
              </p>
              {onchain ? (
                <button
                  type="button"
                  onClick={() => void writeNow()}
                  disabled={saving}
                  className="self-start text-text underline underline-offset-4 disabled:opacity-50"
                >
                  Write on chain now
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          <Button
            variant="primary"
            size="lg"
            block
            loading={saving}
            disabled={!dirty || loading}
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : 'Save profile'}
          </Button>

          {dirty && !saving ? (
            <Button variant="ghost" size="lg" onClick={revert}>
              Revert
            </Button>
          ) : null}
        </div>

        {/* Only offered once there is something to remove. A destructive button
            that does nothing is still a destructive button to read past. */}
        {published && !dirty ? (
          <Button
            variant="ghost"
            size="lg"
            block
            icon={<Trash2 size={16} aria-hidden />}
            loading={saving}
            onClick={() => void clear()}
          >
            Remove profile
          </Button>
        ) : null}

        {loading ? (
          <p className="flex items-center gap-2 text-sm text-text-faint">
            <Loader2 size={14} aria-hidden className="animate-spin" />
            Reading your profile…
          </p>
        ) : null}

        {state.kind === 'stored' ? (
          <p className="text-sm text-positive" role="status">
            Saved. No fee — your wallet signed it, nothing was sent.
          </p>
        ) : null}

        {state.kind === 'done' ? (
          <p className="text-sm text-positive" role="status">
            Written on chain.{' '}
            <a
              className="underline underline-offset-4"
              href={explorerTxUrl(state.hash)}
              target="_blank"
              rel="noreferrer noopener"
            >
              View transaction
            </a>
          </p>
        ) : null}

        {state.kind === 'failed' ? (
          <p className="break-words text-sm text-negative" role="alert">
            {state.message}
          </p>
        ) : null}
      </div>
    </Modal>
  )
}

const INPUT =
  'w-full rounded-control border border-border bg-surface px-3 py-2 text-base outline-none placeholder:text-text-faint'

/**
 * A labelled row with its visibility on it.
 *
 * Every field carries the badge today because every field is public. It is a
 * component and not a hardcoded word so that the first field which is not —
 * the private half of this, when it arrives — differs by one prop rather than
 * by a redesign of the form.
 */
function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm text-text-muted">
          {label}
          <span className="rounded-pill border border-border px-1.5 py-px text-label text-text-faint">
            Public
          </span>
        </span>
        {hint ? <span className="text-label text-text-faint">{hint}</span> : null}
      </span>
      {children}
    </label>
  )
}

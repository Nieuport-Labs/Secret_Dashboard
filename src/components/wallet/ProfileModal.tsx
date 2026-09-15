import { Check, Copy, ExternalLink, Globe, Loader2, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import Avatar from '@/components/wallet/Avatar'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { explorerTxUrl } from '@/chains/secret4'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'
import { shortenAddress } from '@/lib/format'
import { LIMITS, LINK_KINDS, registryConfigured } from '@/lib/profile'
import { clearProfileImage, saveProfileImage, toAvatarDataUrl } from '@/lib/profileImage'
import { profileUrl } from '@/lib/profileLink'
import { useOwnProfile } from '@/hooks/useOwnProfile'

interface Props {
  open: boolean
  onClose: () => void
  address: string
}

/**
 * The profile editor: everything this account publishes about itself, and the
 * one button that puts it on chain.
 *
 * A dialog rather than a page because it is reached from the account chip in
 * the header, which is on every screen — sending someone to a settings route to
 * change their picture and then leaving them there is how an edit becomes a
 * detour. It is also where the shareable link now lives, having been moved out
 * of Receive: the link is about who you are, Receive is about being paid, and
 * having the link in both places meant neither was where people looked.
 *
 * Every field here is public, and the dialog says so rather than assuming it is
 * obvious. On a chain whose entire premise is that balances are nobody's
 * business, a form that quietly publishes a name would be a betrayal of the
 * only expectation the user arrived with.
 */
export default function ProfileModal({ open, onClose, address }: Props) {
  const { draft, update, revert, save, clear, loading, state, dirty, published } = useOwnProfile()

  const [imageError, setImageError] = useState<string | undefined>()
  const [encoding, setEncoding] = useState(false)
  const [copied, setCopied] = useState(false)

  const configured = registryConfigured()

  /*
   * One picture, two copies, one action. The 64px one is what goes on chain and
   * what strangers see; the sharp 256px one stays in IndexedDB for this
   * browser's own header. Writing both here is what stops the two drifting into
   * the state where the owner sees one avatar and everybody else sees another.
   */
  const pick = async (file: File) => {
    setImageError(undefined)
    setEncoding(true)
    try {
      const encoded = await toAvatarDataUrl(file)
      await saveProfileImage(address, file)
      update({ avatar: encoded })
    } catch (caught) {
      setImageError(errorMessage(caught))
    } finally {
      setEncoding(false)
    }
  }

  const removeImage = async () => {
    setImageError(undefined)
    await clearProfileImage(address)
    update({ avatar: '' })
  }

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

  return (
    <Modal open={open} onClose={onClose} title="Profile" size="lg">
      {/*
        Stated once, at the top, before anything has been typed. Per-field
        badges below repeat it where the decision is actually made, because a
        banner read on the way in is forgotten by the third field.
      */}
      <div className="flex items-start gap-2.5 rounded-card border border-border bg-surface p-3">
        <Globe size={16} aria-hidden className="mt-0.5 shrink-0 text-text-muted" />
        <p className="text-sm text-text-muted">
          Everything here is <span className="font-semibold text-text">public</span>. Anyone with your address
          can read it, and the transaction that saves it stays on chain — including after you clear it. Your
          balances and activity are not part of this and stay private.
        </p>
      </div>

      <div className="flex flex-col items-center gap-3">
        <Avatar
          address={address}
          url={draft.avatar || undefined}
          size={96}
          onPick={(file) => void pick(file)}
          onRemove={draft.avatar ? () => void removeImage() : undefined}
          saving={encoding}
        />
        <p className="text-label text-text-faint">
          Stored on chain at 64px, so the picture travels with the link instead of living on somebody else's
          server.
        </p>
      </div>

      {imageError ? (
        <p className="text-sm text-negative" role="alert">
          {imageError}
        </p>
      ) : null}

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

      {/*
        Moved here from Receive. It belongs with the things that decide what the
        page it opens will say — a link is worth sharing in proportion to what
        is behind it, and that is edited two inches above.
      */}
      <div className="flex flex-col gap-2 rounded-card border border-border p-3">
        <div className="flex items-center justify-between gap-3">
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

      <div className="flex flex-col gap-2.5">
        {!configured ? (
          <p className="text-sm text-text-muted" role="status">
            The profile registry is not deployed on this network yet, so there is nowhere to save to.
            Everything above still works — it just cannot be published.
          </p>
        ) : null}

        <div className="flex items-center gap-2">
          <Button
            variant="primary"
            size="lg"
            block
            loading={saving}
            disabled={!configured || !dirty || loading || encoding}
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : 'Save onchain'}
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
            Remove from chain
          </Button>
        ) : null}

        {loading ? (
          <p className="flex items-center gap-2 text-sm text-text-faint">
            <Loader2 size={14} aria-hidden className="animate-spin" />
            Reading your profile…
          </p>
        ) : null}

        {state.kind === 'done' ? (
          <p className="text-sm text-positive" role="status">
            Saved.{' '}
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

import { hueFor } from '@/lib/identicon'

interface Props {
  address: string
  moniker: string
  /** From Keybase, when the validator published an identity and it resolved. */
  image?: string
  size?: number
}

/**
 * A validator's picture, or a colour standing in for one.
 *
 * The chain never carries a picture — `description.identity` is a Keybase key
 * fingerprint, and the image comes from looking that up (see
 * `lib/validatorImage.ts`). Roughly half of bonded validators do not publish
 * one at all, and Keybase can simply be unreachable, so a fallback is not an
 * edge case here — it is closer to half of what actually renders.
 */
export default function ValidatorAvatar({ address, moniker, image, size = 32 }: Props) {
  if (image) {
    return (
      <img
        src={image}
        alt=""
        className="shrink-0 rounded-pill object-cover"
        style={{ width: size, height: size }}
        // A picture that fails to load (Keybase's CDN, not just the lookup,
        // can be the thing that's down) should fall back rather than leave a
        // broken-image icon sitting in the row.
        onError={(event) => {
          event.currentTarget.style.display = 'none'
        }}
      />
    )
  }

  const hue = hueFor(address)
  // Monikers often lead with an emoji flourish (see "🪐 Secret Saturn" on
  // secret-4 itself); the first *letter* is what makes two fallbacks tell
  // apart, so emoji and punctuation are skipped rather than shown as the
  // initial.
  const initial = [...moniker].find((char) => /[\p{L}\p{N}]/u.test(char))?.toUpperCase() ?? '?'

  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-pill font-semibold text-white"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(140deg, hsl(${hue} 62% 38%), hsl(${(hue + 40) % 360} 58% 22%))`,
        fontSize: size * 0.42
      }}
    >
      {initial}
    </span>
  )
}

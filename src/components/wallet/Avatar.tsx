import { Camera, Trash2 } from 'lucide-react'
import { useId, useRef } from 'react'

import { cn } from '@/lib/cn'
import { hueFor } from '@/lib/identicon'

interface Props {
  address: string
  /** Object URL of the stored picture, if there is one. */
  url?: string
  size?: number
  onPick?: (file: File) => void
  onRemove?: () => void
  saving?: boolean
}

export default function Avatar({ address, url, size = 100, onPick, onRemove, saving = false }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const inputId = useId()
  const editable = Boolean(onPick)

  const hue = hueFor(address)
  // bech32 drops the `secret1` prefix for the initial; the prefix is the same on
  // every address here and would make every fallback identical.
  const initial = address.slice(7, 8).toUpperCase()

  return (
    <div className="group relative shrink-0" style={{ width: size, height: size }}>
      {url ? (
        <img
          src={url}
          alt=""
          className="size-full rounded-pill object-cover"
          style={{ width: size, height: size }}
        />
      ) : (
        <span
          aria-hidden
          className="flex size-full items-center justify-center rounded-pill font-semibold text-white"
          style={{
            background: `linear-gradient(140deg, hsl(${hue} 62% 38%), hsl(${(hue + 40) % 360} 58% 22%))`,
            fontSize: size * 0.38
          }}
        >
          {initial}
        </span>
      )}

      {editable ? (
        <>
          <label
            htmlFor={inputId}
            className={cn(
              'absolute inset-0 flex cursor-pointer items-center justify-center rounded-pill',
              'bg-black/60 text-white opacity-0 transition-opacity',
              'duration-[var(--duration-short)] ease-[var(--ease-standard)]',
              // Keyboard users never hover, so focus has to reveal it too.
              'group-hover:opacity-100 group-focus-within:opacity-100',
              saving && 'opacity-100'
            )}
          >
            <Camera size={Math.round(size * 0.22)} aria-hidden />
            <span className="sr-only">Change profile picture</span>
          </label>
          <input
            ref={input}
            id={inputId}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) onPick?.(file)
              // Clearing lets the same file be picked again after a removal.
              event.target.value = ''
            }}
          />
          {url && onRemove ? (
            <button
              type="button"
              onClick={onRemove}
              aria-label="Remove profile picture"
              className={cn(
                'state-layer glass absolute -bottom-1 -right-1 rounded-pill border border-glass-edge p-1.5 text-text-muted',
                'opacity-0 transition-opacity duration-[var(--duration-short)]',
                'group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100'
              )}
            >
              <Trash2 size={14} aria-hidden />
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

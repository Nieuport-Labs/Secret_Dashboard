import { ArrowDownToLine, ArrowLeftRight, Check, Copy, Send, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import Avatar from '@/components/wallet/Avatar'
import type { WalletPanel } from '@/components/wallet/panels'
import Button from '@/components/ui/Button'
import { useProfileImage } from '@/hooks/useProfileImage'
import { shortenAddress } from '@/lib/format'

interface Props {
  address: string
  onOpenPanel: (panel: WalletPanel) => void
}

/** Icon on the left, matching the noun of the action rather than a generic
 *  arrow — Wrap gets a shield because what it does is move a balance into or
 *  out of the private, encrypted half of the account. */
const ACTIONS: Array<{ panel: WalletPanel | 'bridge'; label: string; icon: typeof Send }> = [
  { panel: 'send', label: 'Send', icon: Send },
  { panel: 'receive', label: 'Receive', icon: ArrowDownToLine },
  { panel: 'wrap', label: 'Wrap', icon: ShieldCheck },
  { panel: 'bridge', label: 'Bridge', icon: ArrowLeftRight }
]

/**
 * Who you are (Figma 36:157, identity half only — the balance half lives
 * beside `ActivityList` now, so the two right-hand columns share a width).
 */
export default function ProfileHeader({ address, onOpenPanel }: Props) {
  const navigate = useNavigate()
  const { url, upload, remove, saving, error } = useProfileImage()
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // Clipboard access can be refused; the address is on screen to select.
    }
  }

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
      <Avatar
        address={address}
        url={url}
        onPick={(file) => void upload(file)}
        onRemove={() => void remove()}
        saving={saving}
      />

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="min-w-0">
          <h1 className="text-display">Hello 👋</h1>
          <button
            type="button"
            onClick={() => void copy()}
            className="state-layer -ml-2 mt-0.5 flex max-w-full min-w-0 items-center gap-2 rounded-control py-1 pl-2 pr-2.5 text-base font-semibold text-text-faint"
          >
            {/*
              A bech32 address is 45 characters and will not always fit —
              elided in the middle on narrow layouts, and truncated with an
              ellipsis on wider ones if the column still ends up short of it,
              rather than overflowing past the icon that copies it.
            */}
            <span className="block min-w-0 truncate md:hidden">{shortenAddress(address, 12, 6)}</span>
            <span className="hidden min-w-0 truncate md:block">{address}</span>
            {copied ? (
              <Check size={15} aria-hidden className="shrink-0 text-positive" />
            ) : (
              <Copy size={15} aria-hidden className="shrink-0" />
            )}
            <span className="sr-only">{copied ? 'Address copied' : 'Copy address'}</span>
          </button>
        </div>

        {error ? (
          <p className="text-base text-negative" role="alert">
            {error}
          </p>
        ) : null}

        <div className="flex gap-2">
          {ACTIONS.map(({ panel, label, icon: Icon }) => (
            <Button
              key={panel}
              variant="soft"
              shape="control"
              size="lg"
              icon={<Icon size={14} aria-hidden />}
              onClick={() => (panel === 'bridge' ? navigate('/bridge') : onOpenPanel(panel))}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  )
}

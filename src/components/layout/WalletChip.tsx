import { ChevronDown, LogOut, Settings as SettingsIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { shortenAddress } from '@/lib/format'
import { useWallet } from '@/store/wallet'

interface Props {
  onOpenSettings: () => void
}

/** The connected address and its menu (Figma 34:668). */
export default function WalletChip({ onOpenSettings }: Props) {
  const address = useWallet((state) => state.address)
  const accountName = useWallet((state) => state.accountName)
  const disconnect = useWallet((state) => state.disconnect)

  const [open, setOpen] = useState(false)
  const wrapper = useRef<HTMLDivElement>(null)

  // A menu that stays open when you click elsewhere feels stuck.
  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  if (!address) return null

  return (
    <div ref={wrapper} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="state-layer flex items-center gap-2 rounded-control px-2 py-1 text-base font-semibold"
      >
        <img src="/img/secret-mark.svg" alt="" className="h-5 w-5 shrink-0" />
        <span className="whitespace-nowrap">{shortenAddress(address)}</span>
        <ChevronDown size={14} aria-hidden className="text-text-muted" />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+8px)] z-30 flex min-w-[220px] flex-col gap-1 rounded-card bg-surface-3 p-2 motion-safe:animate-[modal-in_var(--duration-short)_var(--ease-emphasised)]"
        >
          {accountName ? <p className="px-3 pb-1 pt-2 text-sm text-text-faint">{accountName}</p> : null}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onOpenSettings()
            }}
            className="state-layer flex items-center gap-2.5 rounded-control px-3 py-2 text-left text-base"
          >
            <SettingsIcon size={16} aria-hidden />
            Settings
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              disconnect()
            }}
            className="state-layer flex items-center gap-2.5 rounded-control px-3 py-2 text-left text-base"
          >
            <LogOut size={16} aria-hidden />
            Disconnect
          </button>
        </div>
      ) : null}
    </div>
  )
}

import { Fuel } from 'lucide-react'
import { useEffect, useState } from 'react'

import BuyCreditsModal from '@/components/gas/BuyCreditsModal'
import { fromBaseUnits } from '@/lib/format'
import { useFeePayer, vaultCredit } from '@/store/feePayer'
import { useWallet } from '@/store/wallet'

/**
 * "1.892 gas credits" in the header (Figma 34:660).
 *
 * Shows what the vault still covers for this account, in SCRT. It is a fee
 * allowance, not a balance: it can only ever pay gas, and it is spent by
 * transactions rather than transferred.
 */
export default function GasCreditsChip() {
  const address = useWallet((state) => state.address)
  const grants = useFeePayer((state) => state.grants)
  const refresh = useFeePayer((state) => state.refresh)
  const [buyOpen, setBuyOpen] = useState(false)

  useEffect(() => {
    void refresh()
  }, [address, refresh])

  if (!address) return null

  const credit = vaultCredit(grants)
  // No grant from the vault at all reads differently from one that is empty.
  const label = credit === undefined ? 'Get gas credits' : `${fromBaseUnits(credit)} gas credits`

  return (
    <>
      <button
        type="button"
        onClick={() => setBuyOpen(true)}
        className="state-layer flex items-center gap-1.5 rounded-pill border border-border px-2.5 py-1.5 text-base font-medium text-accent"
      >
        <Fuel size={14} aria-hidden />
        {label}
      </button>
      <BuyCreditsModal open={buyOpen} onClose={() => setBuyOpen(false)} />
    </>
  )
}

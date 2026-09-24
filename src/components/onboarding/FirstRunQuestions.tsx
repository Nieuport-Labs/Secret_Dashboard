import { Coins, Fuel, PackageOpen, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'

import ChoiceCard from '@/components/ui/ChoiceCard'
import Modal from '@/components/ui/Modal'
import { DISPLAY_DENOM } from '@/chains/secret4'
import { errorMessage } from '@/lib/errors'
import type { AssetMode, GasMode } from '@/lib/settingsRecord'
import { completeOnboarding, useSettingsSync } from '@/store/settingsSync'
import { useWallet } from '@/store/wallet'

/**
 * Two questions, asked once per account the first time it connects, in the
 * same shape as "Add an account": a dialog, two cards, pick one.
 *
 * Whether to ask is `store/settingsSync.ts`'s call — an account whose
 * settings are on the server has answered. The answers become ordinary
 * settings, toggled later in Settings and synced like the rest.
 *
 * It cannot be skipped: there is no close button, and neither the scrim nor
 * Escape closes it. Disconnecting the wallet is the only other way out.
 */
export default function FirstRunQuestions() {
  const address = useWallet((state) => (state.status === 'connected' ? state.address : undefined))
  const walletId = useWallet((state) => state.walletId)
  const open = useSettingsSync((state) => state.needsAnswers && state.address === address)

  const [step, setStep] = useState<0 | 1>(0)
  const [gas, setGas] = useState<GasMode>()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    setStep(0)
    setGas(undefined)
    setError(undefined)
  }, [address])

  if (!address || !walletId) return null

  const finish = async (assetMode: AssetMode) => {
    if (!gas) return
    setSaving(true)
    setError(undefined)
    try {
      await completeOnboarding(walletId, address, { gasMode: gas, assetMode })
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setSaving(false)
    }
  }

  if (step === 0) {
    return (
      <Modal open={open} title="How should fees be paid?" description="Step 1 of 2.">
        <div className="flex flex-col gap-2">
          <ChoiceCard
            icon={Fuel}
            title="Auto-refill gas credits"
            description="The app keeps your gas credits topped up, never below 5, so a transaction never stalls on fees."
            recommended
            onClick={() => {
              setGas('autorefill')
              setStep(1)
            }}
          />
          <ChoiceCard
            icon={Coins}
            title={`Stick with ${DISPLAY_DENOM}`}
            description={`Fees come out of your own ${DISPLAY_DENOM}. You have to watch your ${DISPLAY_DENOM} and gas credits balance on your own.`}
            onClick={() => {
              setGas('scrt')
              setStep(1)
            }}
          />
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      open={open}
      onBack={saving ? undefined : () => setStep(0)}
      title="How do you want to use it?"
      description="Step 2 of 2."
    >
      <div className="flex flex-col gap-2">
        <ChoiceCard
          icon={Sparkles}
          title="Easy mode"
          description={`${DISPLAY_DENOM} and private tokens, and nothing else to think about.`}
          onClick={saving ? undefined : () => void finish('easy')}
        />
        <ChoiceCard
          icon={PackageOpen}
          title="Expert mode"
          description={`Lets you unwrap non-${DISPLAY_DENOM} assets to their public state.`}
          onClick={saving ? undefined : () => void finish('expert')}
        />
      </div>
      {saving ? <p className="text-base text-text-muted">Confirm in your wallet — it is free.</p> : null}
      {error ? (
        <p role="alert" className="text-base text-negative">
          {error}
        </p>
      ) : null}
    </Modal>
  )
}

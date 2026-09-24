import { Coins, Fuel, PackageOpen, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'

import ChoiceCard from '@/components/ui/ChoiceCard'
import Modal from '@/components/ui/Modal'
import { DISPLAY_DENOM } from '@/chains/secret4'
import { errorMessage } from '@/lib/errors'
import type { AssetMode, GasMode } from '@/lib/preferencesRecord'
import { canSignPreferences, sendPreferences, signPreferences } from '@/lib/preferencesServer'
import { syncPreferences, usePreferencesStore } from '@/store/preferences'
import { useWallet } from '@/store/wallet'

/**
 * Two questions, asked once per account the first time it connects, in the
 * same shape as "Add an account": a dialog, two cards, pick one.
 *
 * Only the answers are collected here. Nothing in the app acts on them yet.
 *
 * Closing the dialog without answering is allowed and means "not now": it
 * stays closed for this visit and asks again on the next one.
 */
export default function PreferencesOnboarding() {
  const address = useWallet((state) => (state.status === 'connected' ? state.address : undefined))
  const walletId = useWallet((state) => state.walletId)
  const remember = usePreferencesStore((state) => state.remember)

  const [open, setOpen] = useState(false)
  const [dismissed, setDismissed] = useState<string>()
  const [step, setStep] = useState<0 | 1>(0)
  const [gas, setGas] = useState<GasMode>()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    setOpen(false)
    setStep(0)
    setGas(undefined)
    setError(undefined)
    if (!address || dismissed === address) return

    let current = true
    void syncPreferences(address).then((result) => {
      if (current && result === 'unanswered') setOpen(true)
    })
    return () => {
      current = false
    }
  }, [address, dismissed])

  if (!address || !walletId) return null

  const close = () => {
    setOpen(false)
    setDismissed(address)
  }

  const finish = async (assets: AssetMode) => {
    if (!gas) return
    const preferences = { gas, assets }

    // A wallet that cannot sign a message can still answer; the answers stay
    // on this device, which is all an unsigned copy could safely be.
    if (!canSignPreferences(walletId)) {
      remember(address, { preferences, signedAt: Date.now() })
      setOpen(false)
      return
    }

    setSaving(true)
    setError(undefined)
    try {
      const signed = await signPreferences(walletId, address, preferences)
      remember(address, { preferences, signedAt: signed.body.signedAt, unsent: signed.record })
      setOpen(false)
      // Not awaited by the dialog: the answers are already kept, and a refusal
      // (an account the chain has not seen yet) is retried on the next visit.
      void sendPreferences(signed.record)
        .then(() => remember(address, { preferences, signedAt: signed.body.signedAt }))
        .catch(() => undefined)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setSaving(false)
    }
  }

  if (step === 0) {
    return (
      <Modal
        open={open}
        onClose={close}
        title="How should fees be paid?"
        description="Step 1 of 2. You can change this later."
      >
        <div className="flex flex-col gap-2">
          <ChoiceCard
            icon={Fuel}
            title="Auto-refill gas credits"
            description="Gas credits are topped up for you, so a transaction never stalls on fees."
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
      onClose={close}
      onBack={saving ? undefined : () => setStep(0)}
      title="How do you want to use it?"
      description="Step 2 of 2. You can change this later."
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
          title="Export mode"
          description={`Also unwrap non-${DISPLAY_DENOM} assets, to take them out of Secret Network.`}
          onClick={saving ? undefined : () => void finish('export')}
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

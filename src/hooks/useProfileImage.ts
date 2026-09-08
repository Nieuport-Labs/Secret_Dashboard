import { useCallback, useEffect, useState } from 'react'

import { errorMessage } from '@/lib/errors'
import { clearProfileImage, loadProfileImage, saveProfileImage } from '@/lib/profileImage'
import { useWallet } from '@/store/wallet'

/**
 * The connected account's profile picture, as an object URL.
 *
 * Object URLs are revoked on every change and on unmount. Without that each
 * account switch leaks a blob for the life of the page.
 */
export function useProfileImage() {
  const address = useWallet((state) => state.address)

  const [url, setUrl] = useState<string | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [saving, setSaving] = useState(false)

  const show = useCallback((blob: Blob | undefined) => {
    setUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous)
      return blob ? URL.createObjectURL(blob) : undefined
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    if (!address) {
      show(undefined)
      return
    }

    void loadProfileImage(address).then((blob) => {
      if (!cancelled) show(blob)
    })

    return () => {
      cancelled = true
    }
  }, [address, show])

  // Revoke whatever is still held when the component goes away.
  useEffect(() => () => setUrl((previous) => (previous && URL.revokeObjectURL(previous), undefined)), [])

  const upload = useCallback(
    async (file: File) => {
      if (!address) return
      setSaving(true)
      setError(undefined)
      try {
        show(await saveProfileImage(address, file))
      } catch (caught) {
        setError(errorMessage(caught))
      } finally {
        setSaving(false)
      }
    },
    [address, show]
  )

  const remove = useCallback(async () => {
    if (!address) return
    await clearProfileImage(address)
    show(undefined)
  }, [address, show])

  return { url, upload, remove, saving, error }
}

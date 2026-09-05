/**
 * The profile picture, stored locally and only locally.
 *
 * IndexedDB rather than localStorage: localStorage holds strings, so an image
 * would have to be base64, which inflates it by a third against a 5MB quota
 * that is shared with everything else the app stores. IndexedDB takes the Blob
 * as it is.
 *
 * Keyed by address, so switching account shows that account's picture rather
 * than the previous one. Nothing here leaves the browser — no upload, no
 * gravatar lookup, no address sent anywhere.
 */

const DB_NAME = 'secret-dashboard'
const DB_VERSION = 1
const STORE = 'profile-images'

/** Stored edge length. Enough for the design's 100px avatar on a 2x display. */
const MAX_EDGE = 256

/** Refuse a file larger than this before decoding it. */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB could not be opened'))
  })
}

function transact<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const request = run(db.transaction(STORE, mode).objectStore(STORE))
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
      })
  )
}

/**
 * Downscale to at most MAX_EDGE, square, centre-cropped, re-encoded as WebP.
 *
 * Re-encoding is not only about size: it drops EXIF, which on a photo taken
 * with a phone carries GPS coordinates. Nothing here is uploaded, but a copy of
 * the file with location data in it should not sit in browser storage either.
 */
async function normalise(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  try {
    const edge = Math.min(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = MAX_EDGE
    canvas.height = MAX_EDGE

    const context = canvas.getContext('2d')
    if (!context) throw new Error('This browser could not process the image.')

    context.drawImage(
      bitmap,
      (bitmap.width - edge) / 2,
      (bitmap.height - edge) / 2,
      edge,
      edge,
      0,
      0,
      MAX_EDGE,
      MAX_EDGE
    )

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.86))
    if (!blob) throw new Error('This browser could not encode the image.')
    return blob
  } finally {
    bitmap.close()
  }
}

export async function saveProfileImage(address: string, file: File): Promise<Blob> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`That image is larger than ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB.`)
  }
  if (!file.type.startsWith('image/')) {
    throw new Error('That file is not an image.')
  }

  const blob = await normalise(file)
  await transact('readwrite', (store) => store.put(blob, address))
  return blob
}

/**
 * `undefined` means no picture, whether none was set or storage is unavailable.
 * Both cases show the generated fallback, so they need no distinction.
 */
export async function loadProfileImage(address: string): Promise<Blob | undefined> {
  try {
    return (await transact<Blob | undefined>('readonly', (store) => store.get(address))) ?? undefined
  } catch {
    // Private windows and blocked site data throw on access rather than
    // returning empty. A missing avatar must never break the page.
    return undefined
  }
}

export async function clearProfileImage(address: string): Promise<void> {
  try {
    await transact('readwrite', (store) => store.delete(address))
  } catch {
    /* nothing to undo */
  }
}

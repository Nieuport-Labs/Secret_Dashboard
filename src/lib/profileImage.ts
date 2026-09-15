/**
 * The profile picture: the sharp local copy, and the small one that goes on
 * chain.
 *
 * IndexedDB rather than localStorage: localStorage holds strings, so an image
 * would have to be base64, which inflates it by a third against a 5MB quota
 * that is shared with everything else the app stores. IndexedDB takes the Blob
 * as it is.
 *
 * Keyed by address, so switching account shows that account's picture rather
 * than the previous one. Nothing in the IndexedDB half leaves the browser — no
 * upload, no gravatar lookup, no address sent anywhere.
 *
 * `toAvatarDataUrl` is the exception, and it is deliberately a separate call:
 * it produces the copy the user chooses to publish, and publishing is an act
 * they perform rather than a side effect of picking a file.
 */

import { LIMITS } from '@/lib/profile'

const DB_NAME = 'secret-dashboard'
const DB_VERSION = 1
const STORE = 'profile-images'

/** Stored edge length. Enough for the design's 100px avatar on a 2x display. */
const MAX_EDGE = 256

/**
 * Edge length of the copy that goes on chain.
 *
 * 64px lands at roughly 2-4kB of base64 against the contract's 12kB ceiling,
 * which is the size at which storing the image itself stops being extravagant
 * and starts being cheaper than the alternative. It is displayed at 88px on the
 * profile page and 22px in the header, so the only place it is soft is a
 * retina profile page — and paying for a 128px version to fix that would
 * quadruple the bytes every reader downloads forever.
 */
const CHAIN_EDGE = 64

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
async function normalise(file: Blob, target: number = MAX_EDGE, quality = 0.86): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  try {
    const edge = Math.min(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = target
    canvas.height = target

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
      target,
      target
    )

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', quality))
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

/**
 * The same picture, small enough to live in contract state, as a
 * `data:image/webp;base64,…` URI.
 *
 * Quality is stepped down rather than fixed. A flat setting has to be chosen
 * for the worst case — a noisy photograph, which compresses badly — and then
 * every clean graphic pays for it. Starting high and retrying only when the
 * result will not fit gives most pictures the better encoding and still never
 * hands the contract something it will reject.
 *
 * Throwing on the last attempt is deliberate: a silently truncated or dropped
 * avatar would be discovered after the transaction was signed and paid for.
 */
export async function toAvatarDataUrl(source: Blob): Promise<string> {
  let last = ''

  for (const quality of [0.82, 0.65, 0.5]) {
    const blob = await normalise(source, CHAIN_EDGE, quality)
    last = await readAsDataUrl(blob)
    if (last.length <= LIMITS.avatar) return last
  }

  throw new Error('That picture will not compress small enough to store on chain. Try a simpler image.')
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('The image could not be read.'))
    reader.readAsDataURL(blob)
  })
}

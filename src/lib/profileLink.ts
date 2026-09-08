/**
 * The shape of a shareable profile link, in one place.
 *
 * The address *is* the path — `https://host/secret1abc…` — so the link a person
 * pastes into a chat is the same string they already know their account by,
 * with nothing in front of it to explain.
 *
 * This lives on its own because the shape is repeated in three unrelated
 * places: the route that reads it, the QR code that encodes it, and the copy
 * button that hands it over. Deciding it once here is what stops a later
 * `/p/:address` from being changed in two of them.
 */

export function profilePath(address: string): string {
  return `/${address}`
}

/**
 * The absolute link, for copying and for a QR code.
 *
 * Built from the live origin rather than a configured base URL, so the link
 * copied from a preview deployment points at that preview and the one copied
 * from production points at production — neither quietly sends people to the
 * other.
 */
export function profileUrl(address: string): string {
  return `${window.location.origin}${profilePath(address)}`
}

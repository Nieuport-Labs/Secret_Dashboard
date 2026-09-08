/**
 * Who an address belongs to, as far as anyone else can tell.
 *
 * Today: nobody knows. There is no name service on Secret, and the only avatar
 * the app has is the one in `lib/profileImage.ts`, which lives in the owner's
 * own IndexedDB and never leaves their browser — so a visitor opening someone
 * else's profile genuinely has nothing to go on but the address itself.
 *
 * This returns an empty identity and the profile falls back to what *is*
 * derivable from an address alone: `shortenAddress` for the name and `hueFor`
 * for the avatar, both deterministic, so the owner and every visitor see the
 * same face.
 *
 * It exists as a seam rather than as a value. Public profiles are planned to
 * come from an NFT the account holds, which means a SNIP-721 query and a
 * metadata fetch — asynchronous, failible, and cached. Resolving that belongs
 * behind this signature, and putting the seam in now is what keeps the profile
 * page from being rewritten when it arrives: the page already treats a name and
 * an avatar as things that may or may not exist.
 *
 * When that lands, this grows loading and error state and gains a
 * `lib/profileIdentity.ts` beside it holding the query, in the same split the
 * rest of the app uses.
 */

export interface ProfileIdentity {
  /** A display name, when there is somewhere to get one from. */
  name?: string
  /**
   * An avatar every visitor can see — not the local IndexedDB picture, which
   * by design cannot travel with a link.
   */
  avatarUrl?: string
}

const NOBODY: ProfileIdentity = {}

export function useProfileIdentity(_address: string): ProfileIdentity {
  // A stable object, so a caller putting this in a dependency array does not
  // re-run on every render once this starts returning something real.
  return NOBODY
}

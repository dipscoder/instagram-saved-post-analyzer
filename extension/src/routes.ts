/**
 * Which instagram.com routes we are allowed to act on.
 *
 * For the library this is presentation. For capture it is a trust boundary: Instagram
 * serves the home feed, explore, profile grids, comment threads and the "more from this
 * creator" strip through the *same* GraphQL endpoint as the saved feed, so the URL of the
 * request says almost nothing about what came back. The route the user is actually on is
 * one of the few signals that separates a post you saved from one you were merely shown.
 *
 * Saved lives at `/{username}/saved/`, and a collection at `/{username}/saved/{name}/`.
 */
export function isSavedRoute(pathname: string = location.pathname): boolean {
  // Anchored to the first path segment. Unanchored, `/explore/tags/saved/` matched — a
  // hashtag grid would have mounted the library and been captured as saved posts, which
  // is exactly what the scope fences exist to prevent.
  return /^\/[^/]+\/saved(\/|$)/.test(pathname);
}

/**
 * The view that lists *every* saved post, as opposed to one collection.
 *
 * Capturing is fine anywhere under `/saved` — a collection holds saved posts like any
 * other. Taking a **census** is not: a sweep of one collection reaches the end of that
 * collection, and if that counted as "I have now seen everything you saved", the rest of
 * the library would look like it had been unsaved and be offered for deletion.
 *
 * So this is deliberately a whitelist of the two paths known to be the full feed, and
 * anything unrecognised is treated as a collection. The cost of being wrong that way is
 * that the stray notice doesn't appear; the cost of being wrong the other way is deleting
 * posts the user still has saved.
 */
export function isFullSavedFeed(pathname: string = location.pathname): boolean {
  return /^\/[^/]+\/saved\/?$/.test(pathname) || /^\/[^/]+\/saved\/all-posts\/?$/.test(pathname);
}

/**
 * The full saved feed of the account browsing `pathname`, or null off the saved routes.
 * The popup's "Open Library" goes here: Instagram has no username-free saved URL.
 */
export function savedFeedPath(pathname: string): string | null {
  const match = /^\/([A-Za-z0-9._]{1,30})\/saved(\/|$)/.exec(pathname);
  return match ? `/${match[1]}/saved/` : null;
}

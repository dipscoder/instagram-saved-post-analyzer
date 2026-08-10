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
  return /\/saved(\/|$)/.test(pathname);
}

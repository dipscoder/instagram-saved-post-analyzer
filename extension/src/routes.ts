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
 *
 * `all-posts` rather than `/saved/` itself, because `/saved/` is now the overview of
 * collection covers, where the extension deliberately shows nothing.
 */
export function savedFeedPath(pathname: string): string | null {
  const match = /^\/([A-Za-z0-9._]{1,30})\/saved(\/|$)/.exec(pathname);
  return match ? `/${match[1]}/saved/all-posts/` : null;
}

/** A saved collection the user has opened: what the in-page pill is about. */
export interface SavedCollection {
  /** `all-posts`, `audio`, or the collection's numeric id. */
  id: string;
  /** What the pill calls it. */
  name: string;
}

/**
 * The collection open at `pathname`, or null anywhere else — including the `/saved/`
 * overview itself.
 *
 * This is where the extension is allowed to *show* anything. The overview is a page of
 * collection covers the user is choosing between, and taking it over (as the old
 * library did) got in the way of Instagram itself. Inside a collection the user has
 * picked what to look at, so a small offer to index it is welcome rather than in the way.
 */
export function collectionFromPath(pathname: string = location.pathname): SavedCollection | null {
  const base = /^\/[^/]+\/saved\/([^/]+)\/(?:([0-9]+)\/?)?$/.exec(pathname);
  if (!base) return null;
  const [, slug, id] = base as unknown as [string, string, string | undefined];
  if (!id) {
    if (slug === 'all-posts') return { id: 'all-posts', name: 'All posts' };
    if (slug === 'audio') return { id: 'audio', name: 'Audio' };
    return null;
  }
  return { id, name: prettySlug(slug) };
}

/** `travel-ideas` → `Travel ideas`. Instagram puts the collection's name in the URL. */
function prettySlug(slug: string): string {
  let text = slug;
  try {
    text = decodeURIComponent(slug);
  } catch {
    // A malformed escape is still a usable label as it stands.
  }
  text = text.replace(/[-_]+/g, ' ').trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : 'This collection';
}

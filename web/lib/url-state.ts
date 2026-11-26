import type { View } from './library';

/**
 * Where the user is in the library, as the address bar holds it, so a reload, a bookmark
 * or a shared link lands on the same view, search and open post:
 *
 *   /?view=needs · /?category=Food · /?collection=<id>   the view (none: All saved)
 *   &q=pasta+recipe                                      the search
 *   &post=<shortcode>                                    the open post
 *
 * Pure, so `npm run verify` checks that every state survives the trip.
 */
export interface Place {
  view: View;
  query: string;
  post: string | null;
}

const SHORTCODE = /^[A-Za-z0-9_-]{1,64}$/;
/** Anything longer than a real name is not one: ignored rather than sent to the server. */
const MAX_PARAM = 200;

function param(params: URLSearchParams, key: string): string | null {
  const value = params.get(key)?.trim();
  return value && value.length <= MAX_PARAM ? value : null;
}

export function placeFrom(search: string): Place {
  const params = new URLSearchParams(search);
  const category = param(params, 'category');
  const collection = param(params, 'collection');
  const view: View =
    params.get('view') === 'needs'
      ? { kind: 'needs-look' }
      : category
        ? { kind: 'category', name: category }
        : collection
          ? { kind: 'collection', id: collection }
          : { kind: 'all' };
  const post = params.get('post');
  return { view, query: (params.get('q') ?? '').slice(0, MAX_PARAM), post: post && SHORTCODE.test(post) ? post : null };
}

/** The address for a place: `?…`, or empty for All saved with nothing open. */
export function searchOf({ view, query, post }: Place): string {
  const params = new URLSearchParams();
  if (view.kind === 'needs-look') params.set('view', 'needs');
  if (view.kind === 'category') params.set('category', view.name);
  if (view.kind === 'collection') params.set('collection', view.id);
  if (query.trim()) params.set('q', query.trim());
  if (post) params.set('post', post);
  const s = params.toString();
  return s ? `?${s}` : '';
}

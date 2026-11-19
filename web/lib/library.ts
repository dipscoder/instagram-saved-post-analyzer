import { searchFilters } from '@saved-index/shared/search';
import { UNCATEGORIZED } from '@saved-index/shared/taxonomy';
import { supabase } from './supabase';

/** The columns the library shows. Everything else on the row stays in the database. */
const POST_COLUMNS =
  'shortcode, permalink, handle, caption, hashtags, thumbnail_url, thumbnail_stored, is_video, ' +
  'duration_sec, audio_track_name, category, subcategory, tags, summary, collections, saved_rank';

export interface Post {
  shortcode: string;
  permalink: string;
  handle: string;
  caption: string;
  hashtags: string[];
  thumbnail_url: string;
  thumbnail_stored: boolean;
  is_video: boolean;
  duration_sec: number | null;
  audio_track_name: string | null;
  category: string | null;
  subcategory: string | null;
  tags: string[];
  summary: string | null;
  collections: string[];
  saved_rank: number | null;
}

/** What the sidebar is showing. `needs-look` is every post without a confident category. */
export type View =
  | { kind: 'all' }
  | { kind: 'needs-look' }
  | { kind: 'category'; name: string }
  | { kind: 'collection'; id: string };

export interface Facet {
  key: string;
  label: string;
  count: number;
}

export interface Facets {
  total: number;
  needsLook: number;
  categories: Facet[];
  collections: Facet[];
}

export const PAGE_SIZE = 60;

/** One page of posts for a view and a search, newest saved first. */
export async function fetchPosts(view: View, query: string, page: number): Promise<Post[]> {
  let q = supabase
    .from('posts')
    .select(POST_COLUMNS)
    .order('saved_rank', { ascending: false, nullsFirst: false })
    .order('shortcode')
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

  if (view.kind === 'category') q = q.eq('category', view.name);
  if (view.kind === 'collection') q = q.contains('collections', [view.id]);
  if (view.kind === 'needs-look') q = q.or(`category.is.null,category.eq.${UNCATEGORIZED}`);
  for (const filter of searchFilters(query)) q = q.or(filter);

  const { data, error } = await q.returns<Post[]>();
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * Sidebar counts. Only two narrow columns are read, a page at a time, so a 20k library
 * costs a few small requests rather than one huge one.
 */
export async function fetchFacets(): Promise<Facets> {
  const byCategory = new Map<string, number>();
  const byCollection = new Map<string, number>();
  let total = 0;
  let needsLook = 0;

  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('posts')
      .select('category, collections')
      .order('shortcode')
      .range(from, from + 999)
      .returns<Pick<Post, 'category' | 'collections'>[]>();
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      total++;
      if (!row.category || row.category === UNCATEGORIZED) needsLook++;
      else byCategory.set(row.category, (byCategory.get(row.category) ?? 0) + 1);
      for (const id of row.collections ?? []) byCollection.set(id, (byCollection.get(id) ?? 0) + 1);
    }
    if (!data || data.length < 1000) break;
  }

  const { data: names } = await supabase.from('collections').select('id, name').returns<{ id: string; name: string }[]>();
  const nameOf = new Map((names ?? []).map((n) => [n.id, n.name]));

  const sorted = (m: Map<string, number>, label: (k: string) => string): Facet[] =>
    [...m].map(([key, count]) => ({ key, label: label(key), count })).sort((a, b) => a.label.localeCompare(b.label));

  return {
    total,
    needsLook,
    categories: sorted(byCategory, (k) => k),
    collections: sorted(byCollection, (k) => nameOf.get(k) ?? 'Collection'),
  };
}

/**
 * Thumbnails live in a private bucket at `{user_id}/{shortcode}.jpg`. One batch request
 * signs a page of them for an hour. Instagram's own URL is the fallback, though it expires.
 */
export async function signThumbnails(userId: string, posts: Post[]): Promise<Record<string, string>> {
  const stored = posts.filter((p) => p.thumbnail_stored);
  const urls: Record<string, string> = {};
  if (stored.length > 0) {
    const { data } = await supabase.storage
      .from('thumbnails')
      .createSignedUrls(stored.map((p) => `${userId}/${p.shortcode}.jpg`), 3600);
    for (const item of data ?? []) {
      const shortcode = item.path?.split('/')[1]?.replace(/\.jpg$/, '');
      if (shortcode && item.signedUrl) urls[shortcode] = item.signedUrl;
    }
  }
  for (const p of posts) if (!urls[p.shortcode] && p.thumbnail_url) urls[p.shortcode] = p.thumbnail_url;
  return urls;
}

/**
 * The post's page on Instagram. The stored permalink came through the extension from a
 * page Instagram controls, so it is only used when it really points at instagram.com;
 * otherwise the link is rebuilt from the shortcode.
 */
export function instagramUrl(post: Pick<Post, 'permalink' | 'shortcode'>): string {
  try {
    const url = new URL(post.permalink);
    if (url.protocol === 'https:' && /(^|\.)instagram\.com$/.test(url.hostname)) return url.href;
  } catch {
    // Not a URL at all; fall through.
  }
  return `https://www.instagram.com/p/${encodeURIComponent(post.shortcode)}/`;
}

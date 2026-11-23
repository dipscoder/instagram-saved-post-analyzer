import { searchFilters } from '@saved-index/shared/search';
import { UNCATEGORIZED } from '@saved-index/shared/taxonomy';
import { supabase } from './supabase';

/** The columns the library shows. Everything else on the row stays in the database. */
const POST_COLUMNS =
  'shortcode, permalink, handle, caption, hashtags, thumbnail_url, thumbnail_stored, is_video, ' +
  'thumbnail_format, duration_sec, audio_track_name, category, subcategory, tags, summary, collections, saved_rank, categorized_at, model_used';

export interface Post {
  shortcode: string;
  permalink: string;
  handle: string;
  caption: string;
  hashtags: string[];
  thumbnail_url: string;
  thumbnail_stored: boolean;
  thumbnail_format: 'jpg' | 'webp' | null;
  is_video: boolean;
  duration_sec: number | null;
  audio_track_name: string | null;
  category: string | null;
  subcategory: string | null;
  tags: string[];
  summary: string | null;
  collections: string[];
  saved_rank: number | null;
  categorized_at: string | null;
  /** Who filed it: a model, 'rules', or 'you' for a category the user chose. */
  model_used: string | null;
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
  /** Of those, never sorted at all (the rest the model filed as not sure). */
  unsorted: number;
  /** Filed, but not yet searchable by meaning. Indexing embeds them for almost nothing. */
  unembedded: number;
  /** Filed and searchable, but reels whose words are not transcribed yet. */
  untranscribed: number;
  /** Never indexed, and failed three times: left out of Index until retried. */
  failed: number;
  categories: Facet[];
  collections: Facet[];
}

export const PAGE_SIZE = 60;

/** One page of posts for a view and a search, newest saved first. */
export async function fetchPosts(view: View, query: string, page: number, signal?: AbortSignal): Promise<Post[]> {
  if (query.trim().length >= 2 && page === 0) {
    const hybrid = await searchPosts(view, query, signal);
    if (hybrid) return hybrid;
  }
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

  if (signal) q = q.abortSignal(signal);
  const { data, error } = await q.returns<Post[]>();
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** The most results a search returns. There is no second page of a search. */
export const SEARCH_LIMIT = 100;

/**
 * Hybrid search on the server (the `search` function): keywords and meaning together,
 * best match first. Null when that function is unavailable, so the caller falls back to
 * keyword-only search and the box keeps working before the function is deployed.
 */
async function searchPosts(view: View, query: string, signal?: AbortSignal): Promise<Post[] | null> {
  const { data, error } = await supabase.functions.invoke<{ posts: Post[] }>('search', {
    body: {
      query,
      category: view.kind === 'category' ? view.name : null,
      collection: view.kind === 'collection' ? view.id : null,
      needsLook: view.kind === 'needs-look',
    },
    signal,
  });
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (error || !Array.isArray(data?.posts)) return null;
  return data.posts;
}

/**
 * Sidebar counts, from one grouped query on the server (`library_facets`). Until that
 * migration has run, falls back to reading two narrow columns a page at a time.
 */
export async function fetchFacets(): Promise<Facets> {
  const [rpc, names] = await Promise.all([
    supabase.rpc('library_facets'),
    supabase.from('collections').select('id, name').returns<{ id: string; name: string }[]>(),
  ]);
  const nameOf = new Map((names.data ?? []).map((n) => [n.id, n.name]));
  type FacetRow = { kind: string; key: string; count: number };
  const rows: FacetRow[] = rpc.error ? await facetRowsByScan() : ((rpc.data ?? []) as FacetRow[]);

  const facets: Facets = { total: 0, needsLook: 0, unsorted: 0, unembedded: 0, untranscribed: 0, failed: 0, categories: [], collections: [] };
  for (const row of rows) {
    const count = Number(row.count);
    if (row.kind === 'total') facets.total = count;
    else if (row.kind === 'unsorted') facets.unsorted = count;
    else if (row.kind === 'unembedded') facets.unembedded = count;
    else if (row.kind === 'untranscribed') facets.untranscribed = count;
    else if (row.kind === 'failed') facets.failed = count;
    else if (row.kind === 'unsure') facets.needsLook += count;
    else if (row.kind === 'category') facets.categories.push({ key: row.key, label: row.key, count });
    else if (row.kind === 'collection') facets.collections.push({ key: row.key, label: nameOf.get(row.key) ?? 'Collection', count });
  }
  facets.needsLook += facets.unsorted + facets.failed;
  facets.categories.sort((a, b) => a.label.localeCompare(b.label));
  facets.collections.sort((a, b) => a.label.localeCompare(b.label));
  return facets;
}

async function facetRowsByScan(): Promise<{ kind: string; key: string; count: number }[]> {
  const counts = new Map<string, number>();
  const bump = (k: string) => counts.set(k, (counts.get(k) ?? 0) + 1);
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('posts')
      .select('category, collections, categorized_at')
      .order('shortcode')
      .range(from, from + 999)
      .returns<(Pick<Post, 'category' | 'collections'> & { categorized_at: string | null })[]>();
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      bump('total\u0000');
      if (!row.categorized_at) bump('unsorted\u0000');
      else if (!row.category || row.category === UNCATEGORIZED) bump('unsure\u0000');
      else bump(`category\u0000${row.category}`);
      for (const id of row.collections ?? []) bump(`collection\u0000${id}`);
    }
    if (!data || data.length < 1000) break;
  }
  return [...counts].map(([k, count]) => {
    const [kind, key] = k.split('\u0000') as [string, string];
    return { kind, key, count };
  });
}

/** Signed thumbnail URLs already in hand, by shortcode, so switching views re-signs nothing. */
const signed = new Map<string, { url: string; until: number }>();
const SIGN_SECONDS = 3600;

/** The URL a post's thumbnail can be shown from right now, if one is known. */
export function knownThumbnail(post: Post): string | undefined {
  const hit = signed.get(post.shortcode);
  if (hit && hit.until > Date.now()) return hit.url;
  return post.thumbnail_stored ? undefined : post.thumbnail_url || undefined;
}

/**
 * Thumbnails live in a private bucket at `{user_id}/{shortcode}.{webp|jpg}`. One batch
 * request signs whatever a page still needs, for an hour. Instagram's own URL is the
 * fallback, though it expires.
 */
export async function signThumbnails(userId: string, posts: Post[]): Promise<void> {
  const now = Date.now();
  const need = posts.filter((p) => p.thumbnail_stored && !((signed.get(p.shortcode)?.until ?? 0) > now));
  if (need.length === 0) return;
  const paths = need.map((p) => `${userId}/${p.shortcode}.${p.thumbnail_format === 'webp' ? 'webp' : 'jpg'}`);
  const { data } = await supabase.storage.from('thumbnails').createSignedUrls(paths, SIGN_SECONDS);
  // Re-sign five minutes before the URL actually lapses.
  const until = now + (SIGN_SECONDS - 300) * 1000;
  for (const item of data ?? []) {
    const shortcode = item.path?.split('/')[1]?.replace(/\.(webp|jpg)$/, '');
    if (shortcode && item.signedUrl) signed.set(shortcode, { url: item.signedUrl, until });
  }
}

/** Instagram handles arrive with or without a leading @; shown with exactly one. */
export function handleOf(post: Pick<Post, 'handle'>): string {
  return post.handle.replace(/^@+/, '').trim();
}

export function profileUrl(handle: string): string {
  return `https://www.instagram.com/${encodeURIComponent(handle)}/`;
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

/** Why a post could not be indexed, as the post panel says it. */
export const INDEX_ERRORS: Record<string, string> = {
  nothing_to_read: 'There is no caption and no picture to go on.',
  no_answer: 'The model did not answer for this post.',
  openai_error: 'OpenAI did not respond.',
  transcribe_failed: 'The reel could not be transcribed.',
};

/** What a post's panel reads when it opens, rather than with every grid page. */
export interface PostDetails {
  /** What is said in a reel; a transcript can run to thousands of words. */
  transcript: string | null;
  /** Why the last indexing attempt failed, and how many have, while it is not indexed. */
  indexError: string | null;
  indexAttempts: number;
  /** A reel's video on file, and when it was transcribed: what indexing it would involve. */
  videoUrl: string | null;
  transcribedAt: string | null;
}

export async function fetchDetails(shortcode: string): Promise<PostDetails> {
  const { data } = await supabase
    .from('posts')
    .select('transcript, index_error, index_attempts, video_url, transcribed_at')
    .eq('shortcode', shortcode)
    .maybeSingle<{
      transcript: string | null;
      index_error: string | null;
      index_attempts: number | null;
      video_url: string | null;
      transcribed_at: string | null;
    }>();
  return {
    transcript: data?.transcript || null,
    indexError: data?.index_error ?? null,
    indexAttempts: data?.index_attempts ?? 0,
    videoUrl: data?.video_url ?? null,
    transcribedAt: data?.transcribed_at ?? null,
  };
}

/** One post as the grid shows it, read again after it changed on the server. */
export async function fetchPost(shortcode: string): Promise<Post | null> {
  const { data, error } = await supabase.from('posts').select(POST_COLUMNS).eq('shortcode', shortcode).maybeSingle<Post>();
  if (error) throw new Error(error.message);
  return data ?? null;
}

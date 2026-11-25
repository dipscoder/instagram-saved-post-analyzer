import { needsPicture, SERVER_QUOTE_USD_PER_POST, SUGGEST_QUOTE_USD_PER_POST } from '@saved-index/shared/filing';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '@saved-index/shared/config';
import { EMBED_QUOTE_USD_PER_POST } from '@saved-index/shared/embedding';
import { MAX_TRANSCRIBE_POSTS, needsTranscript, transcribeQuoteUsd } from '@saved-index/shared/transcript';
import { supabase } from './supabase';

/** Posts to index, newest saved first, with just what decides how they are sent. */
export interface Unsorted {
  shortcode: string;
  caption: string;
  hashtags: string[];
  alt_text: string | null;
  /** Set when the post is already filed and only needs its embedding or transcript. */
  categorized_at: string | null;
  embedded_at: string | null;
  is_video: boolean;
  video_url: string | null;
  transcribed_at: string | null;
  duration_sec: number | null;
}

export async function fetchUnsorted(): Promise<Unsorted[]> {
  const out: Unsorted[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('posts')
      .select('shortcode, caption, hashtags, alt_text, categorized_at, embedded_at, is_video, video_url, transcribed_at, duration_sec')
      // Never filed, filed but not yet searchable by meaning, or a reel not yet transcribed.
      .or('categorized_at.is.null,embedded_at.is.null,and(is_video.is.true,video_url.not.is.null,transcribed_at.is.null)')
      // Failed three times: left out until the post changes or the user presses Try again.
      .lt('index_attempts', 3)
      .order('saved_rank', { ascending: false, nullsFirst: false })
      .order('shortcode')
      .range(from, from + 999)
      .returns<Unsorted[]>();
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

/**
 * What a run is for. `new` organises posts never filed. `upgrade` brings older posts up to
 * date (search by meaning, a reel's words): optional, and offered apart so the main button
 * only ever counts posts the user has not had organised.
 */
export type RunKind = 'new' | 'upgrade' | 'suggest';

export function runKind(p: Pick<Unsorted, 'categorized_at'>): RunKind {
  return p.categorized_at === null ? 'new' : 'upgrade';
}

/**
 * The most a run over these posts can cost. A post only being embedded costs almost
 * nothing; a reel adds its transcription, by its length.
 */
export function quoteUsd(posts: Omit<Unsorted, 'shortcode' | 'caption' | 'hashtags' | 'alt_text'>[]): number {
  return posts.reduce(
    (sum, p) =>
      sum +
      (p.categorized_at ? EMBED_QUOTE_USD_PER_POST : SERVER_QUOTE_USD_PER_POST) +
      (needsTranscript(p) ? transcribeQuoteUsd(p) : 0),
    0,
  );
}

/** What pricing one post needs: the fields that decide what indexing it involves. */
export type OnePost = Pick<Unsorted, 'is_video' | 'video_url' | 'transcribed_at' | 'duration_sec'>;

/**
 * The most indexing one post by hand can cost. It is filed afresh whatever it holds, and a
 * reel never transcribed is listened to first.
 */
export function oneQuoteUsd(p: OnePost): number {
  return quoteUsd([{ ...p, categorized_at: null, embedded_at: null }]);
}

/** A price small enough to read at a glance, rounded up. */
export function priceLabel(usd: number): string {
  return usd < 0.01 ? 'under $0.01' : `up to $${(Math.ceil(usd * 100) / 100).toFixed(2)}`;
}

/**
 * Indexes one post from its panel. `refile` files it with the model even if it was filed
 * before (replacing that answer) or given up on; the server takes it for one post only.
 * True when the post was filed, false when the server could not file it this time; the
 * reason is recorded on the post.
 */
export async function indexOne(shortcode: string, refile: boolean): Promise<boolean> {
  const reply = await sortBatch([shortcode], undefined, { refile });
  return reply.sorted > 0;
}

/**
 * Requests for the server: reels to transcribe and posts that need their picture go 4 at
 * a time, everything else 25 at a time, matching the limits the `sort` function
 * enforces. Both sides decide with the same `needsTranscript` and `needsPicture`, so no
 * reel or picture is left waiting for want of room in a request.
 */
export function sortBatches(posts: Unsorted[]): string[][] {
  const reels = posts.filter(needsTranscript);
  const rest = posts.filter((p) => !reels.includes(p));
  const vision = rest.filter((p) => needsPicture({ caption: p.caption ?? '', hashtags: p.hashtags ?? [], altText: p.alt_text }));
  const text = rest.filter((p) => !vision.includes(p));
  const chunk = (list: Unsorted[], size: number) =>
    Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, i * size + size).map((p) => p.shortcode));
  return [...chunk(text, 25), ...chunk(reels, MAX_TRANSCRIBE_POSTS), ...chunk(vision, 4)];
}

export interface SortReply {
  sorted: number;
  /** Posts given suggested categories, in a suggestions request. */
  suggested: number;
  embedded: number;
  transcribed: number;
  unreadable: string[];
  failed: string[];
  usd: number;
}

export class SortError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Posts filed as not sure before suggestions existed, newest saved first, with what decides
 * how they are batched. Asking about them is category decisions only.
 */
export async function fetchUnsuggested(): Promise<Unsorted[]> {
  const { data, error } = await supabase
    .from('posts')
    .select('shortcode, caption, hashtags, alt_text, categorized_at, embedded_at, is_video, video_url, transcribed_at, duration_sec')
    .not('categorized_at', 'is', null)
    .or(`category.is.null,category.eq.Uncategorized`)
    .is('suggestions', null)
    .neq('model_used', 'you')
    .order('saved_rank', { ascending: false, nullsFirst: false })
    .limit(2000)
    .returns<Unsorted[]>();
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** The most asking for suggestions for this many posts can cost. */
export function suggestQuoteUsd(count: number): number {
  return count * SUGGEST_QUOTE_USD_PER_POST;
}

/** Puts every post that failed three times back into the next run. Spends nothing. */
export async function retryFailed(): Promise<void> {
  const { error } = await supabase.rpc('retry_index_failures');
  if (error) throw new Error(error.message);
}

/** A server or network failure worth one more try, unlike a refusal (sign in, limit, setup). */
export function isTransient(e: unknown): boolean {
  if (!(e instanceof SortError)) return !(e instanceof DOMException && e.name === 'AbortError');
  return e.status === 429 || e.status === 0 || e.status >= 502;
}

/** One request to the `sort` function. */
export async function sortBatch(shortcodes: string[], signal?: AbortSignal, { refile = false, suggest = false } = {}): Promise<SortReply> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new SortError('Sign in again to index.', 401);
  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/sort`, {
      method: 'POST',
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(refile ? { shortcodes, refile } : suggest ? { shortcodes, suggest } : { shortcodes }),
      signal,
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new SortError('Could not reach the server.', 0);
  }
  const body = (await res.json().catch(() => ({}))) as Partial<SortReply> & { error?: string };
  if (!res.ok) {
    const message =
      res.status === 404 ? 'Indexing is not set up on the server yet. Deploy the sort function.' : (body.error ?? `Indexing failed (${res.status}).`);
    throw new SortError(message, res.status);
  }
  return { sorted: body.sorted ?? 0, suggested: body.suggested ?? 0, embedded: body.embedded ?? 0, transcribed: body.transcribed ?? 0, unreadable: body.unreadable ?? [], failed: body.failed ?? [], usd: body.usd ?? 0 };
}

import { needsPicture, SERVER_QUOTE_USD_PER_POST } from '@saved-index/shared/filing';
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

/** One request to the `sort` function. */
export async function sortBatch(shortcodes: string[], signal: AbortSignal): Promise<SortReply> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new SortError('Sign in again to index.', 401);
  const res = await fetch(`${SUPABASE_URL}/functions/v1/sort`, {
    method: 'POST',
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ shortcodes }),
    signal,
  });
  const body = (await res.json().catch(() => ({}))) as Partial<SortReply> & { error?: string };
  if (!res.ok) {
    const message =
      res.status === 404 ? 'Indexing is not set up on the server yet. Deploy the sort function.' : (body.error ?? `Indexing failed (${res.status}).`);
    throw new SortError(message, res.status);
  }
  return { sorted: body.sorted ?? 0, embedded: body.embedded ?? 0, transcribed: body.transcribed ?? 0, unreadable: body.unreadable ?? [], failed: body.failed ?? [], usd: body.usd ?? 0 };
}

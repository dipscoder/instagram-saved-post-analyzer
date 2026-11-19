import { hasTextSignal, SERVER_QUOTE_USD_PER_POST } from '@saved-index/shared/filing';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '@saved-index/shared/config';
import { supabase } from './supabase';

/** Posts never sorted, newest saved first, with just what decides how they are sent. */
export interface Unsorted {
  shortcode: string;
  caption: string;
  hashtags: string[];
  alt_text: string | null;
}

export async function fetchUnsorted(): Promise<Unsorted[]> {
  const out: Unsorted[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('posts')
      .select('shortcode, caption, hashtags, alt_text')
      .is('categorized_at', null)
      .order('saved_rank', { ascending: false, nullsFirst: false })
      .order('shortcode')
      .range(from, from + 999)
      .returns<Unsorted[]>();
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

/** The most a run over `count` posts can cost. */
export function quoteUsd(count: number): number {
  return count * SERVER_QUOTE_USD_PER_POST;
}

/**
 * Requests for the server: posts with text go 25 at a time, posts that need their
 * picture 4 at a time, matching the limits the `sort` function enforces.
 */
export function sortBatches(posts: Unsorted[]): string[][] {
  const text = posts.filter((p) => hasTextSignal({ caption: p.caption, hashtags: p.hashtags ?? [], altText: p.alt_text }));
  const vision = posts.filter((p) => !text.includes(p));
  const chunk = (list: Unsorted[], size: number) =>
    Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, i * size + size).map((p) => p.shortcode));
  return [...chunk(text, 25), ...chunk(vision, 4)];
}

export interface SortReply {
  sorted: number;
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
  if (!token) throw new SortError('Sign in again to sort.', 401);
  const res = await fetch(`${SUPABASE_URL}/functions/v1/sort`, {
    method: 'POST',
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ shortcodes }),
    signal,
  });
  const body = (await res.json().catch(() => ({}))) as Partial<SortReply> & { error?: string };
  if (!res.ok) {
    const message =
      res.status === 404 ? 'Sorting is not set up on the server yet.' : (body.error ?? `Sorting failed (${res.status}).`);
    throw new SortError(message, res.status);
  }
  return { sorted: body.sorted ?? 0, unreadable: body.unreadable ?? [], failed: body.failed ?? [], usd: body.usd ?? 0 };
}

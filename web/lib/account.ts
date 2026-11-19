import { supabase } from './supabase';

const BUCKET = 'thumbnails';

export interface Spend {
  usd: number;
  posts: number;
  /** This calendar month, UTC, since the daily rows are per UTC day. */
  monthUsd: number;
}

/** What indexing has cost this account, from the per-day usage rows. */
export async function fetchSpend(): Promise<Spend> {
  const { data, error } = await supabase.from('usage').select('day, usd, posts');
  if (error) throw new Error(error.message);
  const month = new Date().toISOString().slice(0, 7);
  const rows = (data ?? []) as { day: string; usd: number | string; posts: number }[];
  return rows.reduce<Spend>(
    (sum, r) => ({
      usd: sum.usd + Number(r.usd),
      posts: sum.posts + r.posts,
      monthUsd: sum.monthUsd + (r.day.startsWith(month) ? Number(r.usd) : 0),
    }),
    { usd: 0, posts: 0, monthUsd: 0 },
  );
}

/**
 * Erases the library: every stored picture, then posts, collections and paid summaries
 * in one server call. That call also stamps the account, so each browser running the
 * extension empties its own copy on its next sync instead of uploading it again. The
 * usage rows stay: clearing the library does not clear the bill.
 */
export async function clearLibrary(userId: string): Promise<void> {
  // Removing shifts the listing, so each round lists from the start until it is empty.
  for (;;) {
    const { data, error } = await supabase.storage.from(BUCKET).list(userId, { limit: 1000 });
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    const removed = await supabase.storage.from(BUCKET).remove(data.map((f) => `${userId}/${f.name}`));
    if (removed.error) throw new Error(removed.error.message);
  }
  const { error } = await supabase.rpc('clear_library');
  if (error) throw new Error(error.message);
}

/**
 * What a sync has to send, as pure functions so `npm run verify` can check them.
 *
 * Sync is a diff, not an event log. Each upload remembers a digest of the row it sent;
 * the next sync compares every local post against that digest. Nothing in the write paths
 * has to remember to enqueue anything, a missed or interrupted sync simply catches up on
 * the next one, and a worker killed mid-upload loses nothing.
 */

import { hashText } from '@saved-index/shared/hash';
import type { PostRecord } from '../types';

/** One row of `public.posts`. `user_id` is filled in by the database from the session. */
export interface PostRow {
  shortcode: string;
  permalink: string;
  handle: string;
  caption: string;
  hashtags: string[];
  thumbnail_url: string;
  is_video: boolean;
  duration_sec: number | null;
  audio_track_name: string | null;
  alt_text: string | null;
  posted_at: string | null;
  first_seen_at: string | null;
  saved_rank: number | null;
  category: string | null;
  subcategory: string | null;
  tags: string[];
  summary: string | null;
  categorized_at: string | null;
  model_used: string | null;
}

/**
 * `seenInSavedFeed` is deliberately left out: every sweep re-stamps it, so uploading it
 * would re-send the whole library on every visit to the saved page. The pipeline fields
 * (transcript, embedding, …) are left out because the backend will own them.
 */
export function toRow(r: PostRecord): PostRow {
  return {
    shortcode: r.shortcode,
    permalink: r.permalink,
    handle: r.handle,
    caption: r.caption,
    hashtags: r.hashtags,
    thumbnail_url: r.thumbnailUrl,
    is_video: r.isVideo,
    duration_sec: r.durationSec,
    audio_track_name: r.audioTrackName,
    alt_text: r.altText,
    posted_at: iso(r.postedAt),
    first_seen_at: iso(r.firstSeenAt),
    saved_rank: r.savedRank,
    category: r.category,
    subcategory: r.subcategory,
    tags: r.tags,
    summary: r.summary,
    categorized_at: iso(r.categorizedAt),
    model_used: r.modelUsed,
  };
}

export interface SyncPlan {
  /** Rows that are new or changed since they were last uploaded, with their digests. */
  upserts: { row: PostRow; hash: string }[];
  /** Posts uploaded earlier that are no longer in the local library (pruned as unsaved). */
  deletes: string[];
}

/** `synced` maps shortcode → digest of the row last uploaded for it. */
export function planSync(records: Iterable<PostRecord>, synced: ReadonlyMap<string, string>): SyncPlan {
  const upserts: SyncPlan['upserts'] = [];
  const local = new Set<string>();

  for (const record of records) {
    local.add(record.shortcode);
    const row = toRow(record);
    const hash = hashText(JSON.stringify(row));
    if (synced.get(record.shortcode) !== hash) upserts.push({ row, hash });
  }

  const deletes = [...synced.keys()].filter((shortcode) => !local.has(shortcode));
  return { upserts, deletes };
}

function iso(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString();
}

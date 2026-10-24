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
import type { Verdict } from './ledger';

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
  const list = [...records];
  const local = new Set(list.map((r) => r.shortcode));
  return {
    upserts: changed(list.map(toRow), synced),
    deletes: [...synced.keys()].filter((shortcode) => !local.has(shortcode)),
  };
}

/** Rows whose digest differs from the one last uploaded. */
export function changed<Row extends { shortcode: string }>(
  rows: Iterable<Row>,
  synced: ReadonlyMap<string, string>,
): { row: Row; hash: string }[] {
  const out: { row: Row; hash: string }[] = [];
  for (const row of rows) {
    const hash = digest(row);
    if (synced.get(row.shortcode) !== hash) out.push({ row, hash });
  }
  return out;
}

export function digest(row: object): string {
  return hashText(JSON.stringify(row));
}

// --- the ledger -------------------------------------------------------------

/** One row of `public.verdicts`. Verdicts are only ever added or replaced, never deleted. */
export interface VerdictRow {
  shortcode: string;
  category: string | null;
  subcategory: string | null;
  tags: string[];
  summary: string | null;
  model_used: string;
  categorized_at: string;
  input_hash: string;
  taxonomy_hash: string;
  rules_hash: string;
  ledger_version: number;
}

export function toVerdictRow(v: Verdict): VerdictRow {
  return {
    shortcode: v.shortcode,
    category: v.category,
    subcategory: v.subcategory,
    tags: v.tags,
    summary: v.summary,
    model_used: v.modelUsed,
    categorized_at: new Date(v.categorizedAt).toISOString(),
    input_hash: v.inputHash,
    taxonomy_hash: v.taxonomyHash,
    rules_hash: v.rulesHash,
    ledger_version: v.ledgerVersion,
  };
}

/**
 * A downloaded row in the ledger's own shape. Unchecked: it goes through the ledger's
 * import validation like any file would.
 */
export function fromVerdictRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    shortcode: row['shortcode'],
    category: row['category'],
    subcategory: row['subcategory'],
    tags: row['tags'],
    summary: row['summary'],
    modelUsed: row['model_used'],
    categorizedAt: Date.parse(String(row['categorized_at'])),
    inputHash: row['input_hash'],
    taxonomyHash: row['taxonomy_hash'],
    rulesHash: row['rules_hash'],
    ledgerVersion: row['ledger_version'],
  };
}

// --- thumbnails -------------------------------------------------------------

/** Where a post's thumbnail copy stands. `url` is the source last tried. */
export interface ThumbState {
  shortcode: string;
  stored: boolean;
  url: string;
}

/**
 * Thumbnails still to copy, newest saved first. Only posts already in the account
 * qualify, so the row a thumbnail is attached to always exists. A failed copy is retried
 * only once the post arrives with a different URL: Instagram's are signed and expire, and
 * the same expired URL fails the same way every time.
 */
export function planThumbnails(
  records: Iterable<PostRecord>,
  synced: ReadonlyMap<string, string>,
  thumbs: ReadonlyMap<string, ThumbState>,
): { shortcode: string; url: string }[] {
  const todo: { shortcode: string; url: string; rank: number }[] = [];
  for (const r of records) {
    if (!r.thumbnailUrl || !synced.has(r.shortcode)) continue;
    const state = thumbs.get(r.shortcode);
    if (state && (state.stored || state.url === r.thumbnailUrl)) continue;
    todo.push({ shortcode: r.shortcode, url: r.thumbnailUrl, rank: r.savedRank ?? -Infinity });
  }
  return todo.sort((a, b) => b.rank - a.rank).map(({ shortcode, url }) => ({ shortcode, url }));
}

function iso(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString();
}

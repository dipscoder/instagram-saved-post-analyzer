/**
 * The pure half of the `sort` function: which posts in a request get filed how, and the
 * verdict rows that come out. No I/O, so `npm run verify` checks it in plain Node.
 *
 * The web app sends shortcodes; the server reads those posts itself, so the caller can
 * neither pick what the model sees nor make it file a post that is already sorted. A post
 * is filed exactly as the extension would file it (shared/src/filing.ts), so the verdict
 * hashes match and neither side ever pays for the other's answer again.
 */

import {
  filedByRules,
  filedFromResult,
  hasTextSignal,
  LEDGER_VERSION,
  signature,
  type Filed,
  type FilingInput,
  type ModelResult,
} from '@saved-index/shared/filing';
import { hashText } from '@saved-index/shared/hash';
import { classifyByRules, RULES_HASH, TAXONOMY_HASH } from '@saved-index/shared/taxonomy';

/** One request's posts, and of those, how many may need a picture. */
export const MAX_SORT_POSTS = 25;
export const MAX_VISION_POSTS = 4;

/** The post columns the function reads. */
export const SORT_COLUMNS =
  'shortcode,handle,caption,hashtags,alt_text,is_video,duration_sec,audio_track_name,categorized_at,thumbnail_stored,thumbnail_format';

export interface SortRow {
  shortcode: string;
  handle: string;
  caption: string;
  hashtags: string[];
  alt_text: string | null;
  is_video: boolean;
  duration_sec: number | null;
  audio_track_name: string | null;
  categorized_at: string | null;
  thumbnail_stored: boolean;
  thumbnail_format: 'jpg' | 'webp' | null;
}

export class BadSortRequest extends Error {}

const SHORTCODE = /^[A-Za-z0-9_-]{1,64}$/;

export function parseSortRequest(body: unknown): string[] {
  const raw = (body as { shortcodes?: unknown } | null)?.shortcodes;
  if (!Array.isArray(raw) || raw.length === 0) throw new BadSortRequest('No posts to sort.');
  if (raw.length > MAX_SORT_POSTS) throw new BadSortRequest(`At most ${MAX_SORT_POSTS} posts per request.`);
  if (!raw.every((s) => typeof s === 'string' && SHORTCODE.test(s))) throw new BadSortRequest('A post id is not valid.');
  return [...new Set(raw as string[])];
}

export function toInput(row: SortRow): FilingInput {
  return {
    handle: row.handle ?? '',
    caption: row.caption ?? '',
    hashtags: Array.isArray(row.hashtags) ? row.hashtags : [],
    altText: row.alt_text,
    isVideo: row.is_video === true,
    durationSec: row.duration_sec,
    audioTrackName: row.audio_track_name,
  };
}

export interface SortPlan {
  /** Filed for free by the keyword rules. */
  ruled: { row: SortRow; filed: Filed }[];
  /** Filed from their text in one batch. */
  text: SortRow[];
  /** No usable text: filed from the stored thumbnail, one call each. */
  vision: SortRow[];
  /** Neither text nor a stored thumbnail: nothing to file from. */
  unreadable: SortRow[];
}

/**
 * Splits a request's posts by how they will be filed. A post already sorted is dropped,
 * so a request sent twice bills nothing the second time.
 */
export function planSort(rows: SortRow[]): SortPlan {
  const plan: SortPlan = { ruled: [], text: [], vision: [], unreadable: [] };
  for (const row of rows) {
    if (row.categorized_at) continue;
    const input = toInput(row);
    const hit = classifyByRules(input);
    if (hit) plan.ruled.push({ row, filed: filedByRules(input, hit) });
    else if (hasTextSignal(input)) plan.text.push(row);
    else if (row.thumbnail_stored && plan.vision.length < MAX_VISION_POSTS) plan.vision.push(row);
    else plan.unreadable.push(row);
  }
  return plan;
}

/** What the model is shown for a post: the same bytes the extension sends and hashes. */
export function modelText(row: SortRow): string {
  return signature(toInput(row));
}

export function filedFrom(row: SortRow, result: ModelResult): Filed {
  return filedFromResult(toInput(row), result);
}

/** A row for `apply_verdicts`, which writes it to both `verdicts` and `posts`. */
export function verdictRow(row: SortRow, filed: Filed, model: string, at: Date): Record<string, unknown> {
  return {
    shortcode: row.shortcode,
    category: filed.category,
    subcategory: filed.subcategory,
    tags: filed.tags,
    summary: filed.summary,
    model_used: model,
    categorized_at: at.toISOString(),
    input_hash: hashText(modelText(row)),
    taxonomy_hash: TAXONOMY_HASH,
    rules_hash: RULES_HASH,
    ledger_version: LEDGER_VERSION,
  };
}

/** Where a post's stored thumbnail is, under the caller's own folder. */
export function thumbnailPath(userId: string, row: SortRow): string {
  return `${userId}/${row.shortcode}.${row.thumbnail_format === 'webp' ? 'webp' : 'jpg'}`;
}

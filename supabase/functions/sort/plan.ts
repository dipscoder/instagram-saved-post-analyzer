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
  needsPicture,
  signature,
  type Filed,
  type FilingInput,
  type ModelResult,
} from '@saved-index/shared/filing';
import type { EmbeddingFields } from '@saved-index/shared/embedding';
import { MAX_TRANSCRIBE_POSTS, needsTranscript } from '@saved-index/shared/transcript';
import { hashText } from '@saved-index/shared/hash';
import { classifyByRules, RULES_HASH, TAXONOMY_HASH } from '@saved-index/shared/taxonomy';

/** One request's posts, and of those, how many may need a picture. */
export const MAX_SORT_POSTS = 25;
export const MAX_VISION_POSTS = 4;
/** Failed attempts after which a post is left out until it changes or the user retries. */
export const MAX_ATTEMPTS = 3;

/** The post columns the function reads. */
export const SORT_COLUMNS =
  'shortcode,handle,caption,hashtags,alt_text,is_video,duration_sec,audio_track_name,categorized_at,thumbnail_stored,thumbnail_format,' +
  'category,subcategory,tags,summary,embedded_at,video_url,transcript,transcribed_at,index_attempts,model_used';

/**
 * What a suggestions request also reads. Kept out of SORT_COLUMNS, so filing keeps working
 * on a database where the suggestions migration has not run yet.
 */
export const SUGGEST_COLUMNS = `${SORT_COLUMNS},suggestions`;

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
  category: string | null;
  subcategory: string | null;
  tags: string[] | null;
  summary: string | null;
  embedded_at: string | null;
  video_url: string | null;
  transcript: string | null;
  transcribed_at: string | null;
  /** Failed indexing attempts since the post last changed; at MAX_ATTEMPTS it is left out. */
  index_attempts: number;
  /** Who filed it: a model, 'rules', or 'you' for a category the user chose. */
  model_used?: string | null;
  /** The categories the AI would suggest; null when it has not been asked. */
  suggestions?: string[] | null;
}

export class BadSortRequest extends Error {}

const SHORTCODE = /^[A-Za-z0-9_-]{1,64}$/;

export interface SortRequest {
  shortcodes: string[];
  /**
   * The user asked for this one post by hand, from its panel: file it with the model even
   * if it is filed already (replacing that answer, theirs included) or was given up on.
   * One post at a time, so a re-index can never re-bill a library in one request.
   */
  refile: boolean;
  /**
   * Ask only which categories the AI would suggest for posts it filed as not sure, and
   * never asked about before. Category decisions only: no summary is rewritten.
   */
  suggest: boolean;
  /**
   * Organise again, for many posts: the time the user confirmed the run. Each post filed
   * before it is filed afresh by the model; one filed since (by this run) is left alone, so
   * a batch sent twice bills once. Never a category the user chose by hand. Null otherwise.
   */
  againBefore: string | null;
}

/** How far ahead of the server's clock an Organise again run may say it started. */
const CLOCK_SKEW_MS = 5 * 60_000;

export function parseSortRequest(body: unknown): SortRequest {
  const {
    shortcodes: raw,
    refile = false,
    suggest = false,
    againBefore = null,
  } = (body ?? {}) as { shortcodes?: unknown; refile?: unknown; suggest?: unknown; againBefore?: unknown };
  if (!Array.isArray(raw) || raw.length === 0) throw new BadSortRequest('No posts to sort.');
  if (raw.length > MAX_SORT_POSTS) throw new BadSortRequest(`At most ${MAX_SORT_POSTS} posts per request.`);
  if (!raw.every((s) => typeof s === 'string' && SHORTCODE.test(s))) throw new BadSortRequest('A post id is not valid.');
  if (typeof refile !== 'boolean') throw new BadSortRequest('refile is true or false.');
  if (typeof suggest !== 'boolean') throw new BadSortRequest('suggest is true or false.');
  if (againBefore !== null && !(typeof againBefore === 'string' && Number.isFinite(Date.parse(againBefore)))) {
    throw new BadSortRequest('againBefore is a time.');
  }
  if ([refile, suggest, againBefore !== null].filter(Boolean).length > 1) throw new BadSortRequest('Ask for one kind of run at a time.');
  // A start time in the future would make every resend of a batch bill again.
  if (againBefore !== null && Date.parse(againBefore) > Date.now() + CLOCK_SKEW_MS) throw new BadSortRequest('againBefore is in the future.');
  const shortcodes = [...new Set(raw as string[])];
  if (refile && shortcodes.length !== 1) throw new BadSortRequest('Index again takes one post at a time.');
  return { shortcodes, refile, suggest, againBefore: againBefore === null ? null : new Date(againBefore).toISOString() };
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
    transcript: row.transcript || null,
  };
}

/**
 * The reels this request transcribes before anything is filed: the first few never
 * transcribed. A reel is worth waiting for, since what is said in it is usually the best
 * signal of what it is about.
 */
export function pickTranscribe(rows: SortRow[], { refile = false } = {}): SortRow[] {
  return rows.filter((r) => needsTranscript(r) && (refile || !givenUp(r))).slice(0, MAX_TRANSCRIBE_POSTS);
}

/** Failed often enough that only a change to the post, or the user, brings it back. */
export function givenUp(row: Pick<SortRow, 'index_attempts'>): boolean {
  return (row.index_attempts ?? 0) >= MAX_ATTEMPTS;
}

/** Any words at all to file from, when the picture a thin post needed cannot be read. */
export function hasAnyText(row: SortRow): boolean {
  const p = toInput(row);
  return p.caption.trim() !== '' || p.hashtags.length > 0 || (p.altText ?? '').trim() !== '' || (p.transcript ?? '') !== '';
}

export interface SortPlan {
  /** Filed for free by the keyword rules. */
  ruled: { row: SortRow; filed: Filed }[];
  /** Filed from their text in one batch. */
  text: SortRow[];
  /** Little or no usable text: filed from text and the stored thumbnail, one call each. */
  vision: SortRow[];
  /** Already filed, but not yet searchable by meaning: embedded only. */
  embedOnly: SortRow[];
  /** Neither text nor a stored thumbnail: nothing to file from. */
  unreadable: SortRow[];
  /** Reels still waiting for a transcript: left for a later request rather than filed blind. */
  waiting: SortRow[];
  /** Failed too often: left out, and never billed again, until the post changes. */
  skipped: SortRow[];
}

/**
 * Splits a request's posts by how they will be filed. A post already sorted is only
 * embedded if it is not searchable by meaning yet, never filed again,
 * so a request sent twice bills nothing the second time.
 *
 * `refile` is the one exception, a single post the user asked for by hand: it goes to the
 * model whatever it holds. Not to the keyword rules, which would give back the very
 * answer the user is asking to replace. `againBefore` does the same for a confirmed
 * Organise again run, but only for posts filed before it started and never over the
 * user's own choice, so sending a batch twice still bills once.
 */
export function planSort(rows: SortRow[], { refile = false, againBefore = null as string | null } = {}): SortPlan {
  const plan: SortPlan = { ruled: [], text: [], vision: [], embedOnly: [], unreadable: [], waiting: [], skipped: [] };
  for (const row of rows) {
    const again = refile || fileAgain(row, againBefore);
    if (!refile && givenUp(row) && !row.categorized_at) {
      plan.skipped.push(row);
      continue;
    }
    if (needsTranscript(row)) {
      plan.waiting.push(row);
      continue;
    }
    if (!again && row.categorized_at) {
      if (!row.embedded_at) plan.embedOnly.push(row);
      continue;
    }
    const input = toInput(row);
    const hit = again ? null : classifyByRules(input);
    if (hit) plan.ruled.push({ row, filed: filedByRules(input, hit) });
    else if (needsPicture(input) && row.thumbnail_stored && plan.vision.length < MAX_VISION_POSTS) plan.vision.push(row);
    else if (hasTextSignal(input)) plan.text.push(row);
    else plan.unreadable.push(row);
  }
  return plan;
}

/**
 * Whether an Organise again run files this post afresh: filed before the run started, and
 * not by the user's own hand. A post never filed is organised the ordinary way.
 */
export function fileAgain(row: Pick<SortRow, 'categorized_at' | 'model_used'>, againBefore: string | null): boolean {
  if (!againBefore || !row.categorized_at || row.model_used === 'you') return false;
  return Date.parse(row.categorized_at) < Date.parse(againBefore);
}

/** Filed, but the AI was not sure where: the posts that need a category from the user. */
export function isUnsure(row: Pick<SortRow, 'categorized_at' | 'category'>): boolean {
  return row.categorized_at !== null && (row.category === null || row.category === 'Uncategorized');
}

export interface SuggestPlan {
  text: SortRow[];
  /** Too little text: asked about with their stored thumbnail, one call each. */
  vision: SortRow[];
  /** Nothing to ask from: recorded as asked, with no suggestions, and never billed. */
  unreadable: SortRow[];
}

/**
 * The posts in a suggestions request worth asking about: not sure, never asked, and not
 * placed in Needs a category by the user's own hand. A request sent twice bills nothing
 * the second time, because the first one recorded an answer for every post it asked about.
 */
export function planSuggest(rows: SortRow[]): SuggestPlan {
  const plan: SuggestPlan = { text: [], vision: [], unreadable: [] };
  for (const row of rows) {
    if (!isUnsure(row) || row.model_used === 'you' || Array.isArray(row.suggestions)) continue;
    const input = toInput(row);
    if (needsPicture(input) && row.thumbnail_stored && plan.vision.length < MAX_VISION_POSTS) plan.vision.push(row);
    else if (hasAnyText(row)) plan.text.push(row);
    else plan.unreadable.push(row);
  }
  return plan;
}

/** What a post is embedded from: its new filing when it has one, else what it holds. */
export function embeddingFields(row: SortRow, filed?: Filed): EmbeddingFields {
  return {
    handle: row.handle,
    caption: row.caption,
    hashtags: row.hashtags,
    alt_text: row.alt_text,
    audio_track_name: row.audio_track_name,
    category: filed ? filed.category : row.category,
    subcategory: filed ? filed.subcategory : row.subcategory,
    tags: filed ? filed.tags : row.tags,
    summary: filed ? filed.summary : row.summary,
    transcript: row.transcript,
  };
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

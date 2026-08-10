/** The record shape stored in IndexedDB, keyed on `shortcode`. */

export const SCHEMA_VERSION = 2;

export interface PostRecord {
  /** Primary key. Instagram's per-post code, e.g. "C8xK2mLp3qR". */
  shortcode: string;
  permalink: string;
  handle: string;
  caption: string;
  hashtags: string[];
  thumbnailUrl: string;
  isVideo: boolean;
  durationSec: number | null;
  audioTrackName: string | null;
  altText: string | null;
  /** Epoch ms. Instagram exposes the post's own timestamp, not when you saved it. */
  savedAt: number | null;

  /**
   * Epoch ms of the last time this post was seen *in the saved feed itself*.
   *
   * Every capture path is now scoped to the saved grid, so arriving at all is the
   * confirmation. A full sweep re-stamps everything still saved, which turns "what did
   * this sweep not touch?" into the list of posts that have been unsaved since — or that
   * were captured by an older build that read the whole page. Null on records that
   * predate the field.
   */
  seenInSavedFeed: number | null;

  // --- categorisation output; null until a tier has run ---
  category: string | null;
  subcategory: string | null;
  tags: string[];
  summary: string | null;
  categorizedAt: number | null;
  /** "rules" for the deterministic pre-pass, otherwise the model id. */
  modelUsed: string | null;

  // --- declared for a downstream pipeline; this extension never populates them.
  // Present in the schema so backfilling needs no migration. ---
  transcript: string | null;
  ocrText: string | null;
  embedding: number[] | null;
  perceptualHash: string | null;

  schemaVersion: number;
}

/** What the capture layer can know before anything has been categorised. */
export type CapturedPost = Pick<
  PostRecord,
  | 'shortcode'
  | 'permalink'
  | 'handle'
  | 'caption'
  | 'hashtags'
  | 'thumbnailUrl'
  | 'isVideo'
  | 'durationSec'
  | 'audioTrackName'
  | 'altText'
  | 'savedAt'
>;

export function toRecord(p: CapturedPost): PostRecord {
  return {
    ...p,
    // Capture only runs on the saved route now, so reaching here is the confirmation.
    seenInSavedFeed: Date.now(),
    category: null,
    subcategory: null,
    tags: [],
    summary: null,
    categorizedAt: null,
    modelUsed: null,
    transcript: null,
    ocrText: null,
    embedding: null,
    perceptualHash: null,
    schemaVersion: SCHEMA_VERSION,
  };
}

export type ProviderId = 'anthropic' | 'openai' | 'gemini' | 'openrouter';

/**
 * 'overlay' is our own control bar, drawn into document.body. 'native' hands the job to
 * the browser's control strip, which Instagram's click-catcher often sits on top of —
 * see page/video.ts. 'thin' is the legacy name for 'overlay' and is migrated on read.
 */
export type VideoControls = 'overlay' | 'native';

/** Bump when a stored default needs revisiting. Migrations live in settings.ts. */
export const SETTINGS_VERSION = 2;

export interface Settings {
  provider: ProviderId;
  model: string;
  /** Present only in the service worker; storage.local is TRUSTED_CONTEXTS. */
  apiKey: string;
  autoIndex: boolean;
  scrubberSkin: VideoControls;
  settingsVersion: number;
}

export const DEFAULT_SETTINGS: Settings = {
  provider: 'anthropic',
  model: 'claude-haiku-4-5',
  apiKey: '',
  autoIndex: true,
  scrubberSkin: 'overlay',
  settingsVersion: SETTINGS_VERSION,
};

export type IndexPhase = 'idle' | 'running' | 'paused' | 'done' | 'error' | 'offline';

export interface IndexProgress {
  phase: IndexPhase;
  /** Posts captured into the DB. Grows as you scroll — it is not "all your saves". */
  total: number;
  categorized: number;
  /** Captured but not yet through a tier. */
  pending: number;
  /** USD actually charged, summed from the token usage every provider reports back. */
  spentUsd: number;
  /** Upper-bound USD for `pending` at current list prices. Rules make it cheaper. */
  estimateUsd: number;
  /** Human-readable cause when phase is 'error' — surfaced verbatim in the UI. */
  message: string | null;
}

export const IDLE_PROGRESS: IndexProgress = {
  phase: 'idle',
  total: 0,
  categorized: 0,
  pending: 0,
  spentUsd: 0,
  estimateUsd: 0,
  message: null,
};

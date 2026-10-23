/** The record shape stored in IndexedDB, keyed on `shortcode`. */

export const SCHEMA_VERSION = 3;

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
  /** Epoch ms the post itself was published. Instagram's `taken_at`. */
  postedAt: number | null;

  /**
   * Epoch ms this extension first stored the post. Null for records that predate the
   * field. Not the same thing as when you saved it — but for anything saved while the
   * extension is installed, it is within a browse of it.
   */
  firstSeenAt: number | null;

  /**
   * Where the post sat in the saved feed, folded with which visit saw it.
   *
   * Instagram does not send a save *timestamp* anywhere in the saved feed. It does send
   * the posts newest-saved first, which answers the same question for every purpose
   * except putting a date on it. See background/order.ts for how the number is built.
   * Sorts descending: highest is most recently saved. Null on records captured before
   * the field existed, which sorts them last.
   */
  savedRank: number | null;

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
  | 'postedAt'
>;

export function toRecord(p: CapturedPost, savedRank: number | null = null): PostRecord {
  return {
    ...p,
    // Capture only runs on the saved route now, so reaching here is the confirmation.
    seenInSavedFeed: Date.now(),
    firstSeenAt: Date.now(),
    savedRank,
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

/** OpenAI only, by product decision. Kept as a type so the settings shape stays explicit. */
export type ProviderId = 'openai';

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
  provider: 'openai',
  model: 'gpt-5.6-luna',
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
  /** Posts frozen into the current/most recent run when it began. */
  runTotal: number;
  /** Posts from that frozen set which have reached a final verdict. */
  runCompleted: number;
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
  runTotal: 0,
  runCompleted: 0,
  spentUsd: 0,
  estimateUsd: 0,
  message: null,
};

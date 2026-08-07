/** The record shape stored in IndexedDB, keyed on `shortcode`. */

export const SCHEMA_VERSION = 1;

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

export interface Settings {
  provider: ProviderId;
  model: string;
  /** Present only in the service worker; storage.local is TRUSTED_CONTEXTS. */
  apiKey: string;
  autoIndex: boolean;
  /** 'native' uses the browser's own controls; 'thin' uses our scrubber skin. */
  scrubberSkin: 'native' | 'thin';
}

export const DEFAULT_SETTINGS: Settings = {
  provider: 'anthropic',
  model: 'claude-haiku-4-5',
  apiKey: '',
  autoIndex: true,
  scrubberSkin: 'native',
};

export type IndexPhase = 'idle' | 'running' | 'paused' | 'done' | 'error' | 'offline';

export interface IndexProgress {
  phase: IndexPhase;
  total: number;
  categorized: number;
  /** Human-readable cause when phase is 'error' — surfaced verbatim in the UI. */
  message: string | null;
}

/**
 * Reel transcription: which reels to transcribe, what it costs, and how a transcript is
 * kept. Pure; the `sort` function does the download and the call.
 *
 * Instagram gives reels on the web no transcript of their own, and for a reel the words
 * spoken are usually the best signal of what it is about. The account transcribes each
 * reel once, from its smallest rendition on Instagram's CDN.
 */

export const TRANSCRIBE_MODEL = 'gpt-transcribe';
/** Reels transcribed in one `sort` request: each is a download and an upload. */
export const MAX_TRANSCRIBE_POSTS = 4;
/** USD per minute of audio, list price. */
const PRICE_PER_MINUTE = 0.0045;
/** The transcription endpoint's upload limit. */
export const MAX_VIDEO_BYTES = 25 * 1024 * 1024;
/** Longer than this is not a reel worth paying to transcribe in full. */
export const MAX_REEL_SECONDS = 600;
/** Assumed when Instagram sent no duration: a long reel. */
const UNKNOWN_SECONDS = 90;
/** Kept on the post; more than this is a lecture, and the opening says what it is. */
const MAX_TRANSCRIPT_CHARS = 20_000;

export interface ReelFields {
  is_video: boolean;
  video_url: string | null;
  transcribed_at: string | null;
  duration_sec: number | null;
}

/** A reel with a video on file that has never been transcribed. */
export function needsTranscript(p: ReelFields): boolean {
  return p.is_video === true && typeof p.video_url === 'string' && p.video_url !== '' && !p.transcribed_at;
}

/** Too long to transcribe: recorded as tried, with no transcript, and never billed. */
export function tooLong(p: Pick<ReelFields, 'duration_sec'>): boolean {
  return (p.duration_sec ?? 0) > MAX_REEL_SECONDS;
}

export function transcribeCostUsd(durationSec: number | null): number {
  return ((durationSec && durationSec > 0 ? durationSec : UNKNOWN_SECONDS) / 60) * PRICE_PER_MINUTE;
}

/** The most transcribing a reel can cost, for the quote shown before indexing. */
export function transcribeQuoteUsd(p: Pick<ReelFields, 'duration_sec'>): number {
  return tooLong(p) ? 0 : transcribeCostUsd(p.duration_sec);
}

/**
 * The text of a transcription reply, and the seconds it was billed for when the reply
 * says (else the reel's own duration). `text` is null when the reply is not one.
 */
export function readTranscript(reply: unknown, durationSec: number | null): { text: string | null; seconds: number | null } {
  const r = reply as { text?: unknown; usage?: { seconds?: unknown } } | null;
  if (typeof r?.text !== 'string') return { text: null, seconds: null };
  const billed = Number(r.usage?.seconds);
  return { text: cleanTranscript(r.text) ?? '', seconds: billed > 0 ? billed : durationSec };
}

/** A transcript as stored: whitespace collapsed, bounded, and null when nothing was said. */
export function cleanTranscript(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const clean = text.replace(/\s+/g, ' ').trim().slice(0, MAX_TRANSCRIPT_CHARS);
  return clean.length >= 2 ? clean : null;
}

/** A host on Instagram's own CDN, nothing before it (no user info) and no port after it. */
const INSTAGRAM_VIDEO = /^https:\/\/[a-z0-9.-]+\.(?:cdninstagram\.com|fbcdn\.net)(?:[/?#]|$)/i;

/** Only Instagram's own CDN, over HTTPS: the server fetches nothing else on a post's say-so. */
export function isInstagramVideoUrl(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 4_000 && INSTAGRAM_VIDEO.test(value);
}

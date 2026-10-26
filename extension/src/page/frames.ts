/**
 * The arithmetic behind frame stepping and frame capture. Pure, so `npm run verify`
 * checks it in plain Node; video.ts does the DOM side.
 *
 * A browser does not say what frame rate a video has. It does report, per presented
 * frame, that frame's own timestamp (`requestVideoFrameCallback`'s `mediaTime`), so the
 * frame length is learned from playback and stepping is anchored on the frame on screen.
 */

/** Most reels are 30 fps; used until playback has shown us otherwise. */
export const DEFAULT_FRAME_SECONDS = 1 / 30;

/** Bounds on a believable frame length: 120 fps to 10 fps. */
const MIN_FRAME_SECONDS = 1 / 120;
const MAX_FRAME_SECONDS = 1 / 10;

/**
 * The frame length implied by gaps between consecutive presented frames. The smallest
 * believable gap wins: a dropped frame doubles a gap, it never halves one.
 */
export function frameDuration(gaps: readonly number[]): number {
  let best = Infinity;
  for (const gap of gaps) {
    if (gap >= MIN_FRAME_SECONDS * 0.9 && gap <= MAX_FRAME_SECONDS && gap < best) best = gap;
  }
  return Number.isFinite(best) ? best : DEFAULT_FRAME_SECONDS;
}

/**
 * Where to seek to show the next (`direction` 1) or previous (-1) frame.
 *
 * `anchor` is the start of the frame on screen. Seeking to exactly the next frame's start
 * can round back into the current one, so this aims half a frame in, which is inside the
 * neighbouring frame whatever the rounding.
 */
export function stepTarget(anchor: number, frame: number, direction: 1 | -1, duration: number): number {
  const target = anchor + direction * frame + frame / 2;
  const last = Number.isFinite(duration) && duration > 0 ? Math.max(0, duration - frame / 2) : target;
  return Math.min(last, Math.max(0, target));
}

/** `1:07`, or with `precise`, `1:07.48`: enough to tell neighbouring frames apart. */
export function timecode(seconds: number, precise = false): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  if (!precise) return `${m}:${String(Math.floor(s)).padStart(2, '0')}`;
  const cs = Math.floor(s * 100);
  return `${m}:${String(Math.floor(cs / 100)).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

/** The post's shortcode from an Instagram path or link, if it names one. */
export function shortcodeFrom(path: string): string | null {
  return /\/(?:p|reels?|tv)\/([A-Za-z0-9_-]{5,40})/.exec(path)?.[1] ?? null;
}

/** `instagram-C8xYz12AbCd-0m12.480s.png`: which post, and where in it. */
export function frameFilename(shortcode: string | null, seconds: number): string {
  const t = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const m = Math.floor(t / 60);
  const s = (t - m * 60).toFixed(3).padStart(6, '0');
  return `instagram-${shortcode ?? 'video'}-${m}m${s}s.png`;
}

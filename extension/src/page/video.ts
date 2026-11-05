/**
 * Real seek controls on Instagram videos.
 *
 * ## Why the first version only half-worked
 *
 * Instagram covers every player with a full-bleed click-catcher whose job is to open the
 * post. Two consequences, and the old code tripped over both:
 *
 *  1. `pointerenter` on the `<video>` never fires — the pointer is over the catcher, not
 *     the video — so anything that waited for it showed up only intermittently, if at all.
 *  2. Clicks on the browser's own control strip land on the catcher, so the scrubber
 *     looks live and does nothing. Raising the video's `z-index` only wins when no
 *     ancestor has opened its own stacking context, which on Instagram is a coin flip.
 *
 * ## What this does instead
 *
 * The control bar is a plain `<div>` appended to `document.body` — a sibling of React's
 * root, not a descendant. Two things follow for free: React's delegated event handlers
 * never see our clicks (they are bound at its root container), and no stacking context
 * inside their tree can trap us. Nothing about it depends on an event reaching the
 * `<video>` element.
 *
 * Which player it attaches to is decided **geometrically**: a document-level
 * `pointermove` listener in the capture phase records the cursor, and we bind to the
 * smallest visible `<video>` whose rectangle contains it. A capture-phase listener cannot
 * be suppressed by the page, so this works no matter what the catcher does with events.
 *
 * `mode: 'native'` hands the job back to the browser's control strip for anyone who wants
 * volume sliders and picture-in-picture, and keeps the old z-index lift for it.
 *
 * React re-renders strip our attributes within seconds, so every video also gets its own
 * attribute observer; a document-level observer catches players added later. Both funnel
 * through one rAF-throttled scan, so a mutation storm costs one pass per frame.
 *
 * ## Scrubbing, frames and stills
 *
 * Setting `currentTime` while a seek is still decoding abandons it, so a drag that seeked
 * on every pointer move kept the decoder restarting and the picture frozen until you let
 * go. Seeks are now coalesced: one in flight per video, and only the newest target waits
 * behind it. The slider follows the pointer directly rather than the playhead, so it feels
 * immediate even while the decoder catches up.
 *
 * Stepping goes one frame at a time, anchored on the frame actually on screen (see
 * frames.ts), and a still is drawn from the video element at its own resolution into a
 * canvas of ours. Instagram's DOM, player state and requests are never touched for either.
 */

import type { VideoControls } from '../types';
import { frameDuration, frameFilename, shortcodeFrom, stepTarget, timecode } from './frames';

/** Room left for Instagram's own reel chrome along the bottom of the viewport. */
const BOTTOM_KEEP_OUT_PX = 56;

/**
 * Frame stepping (buttons and `,` / `.`) and saving stills. Switched off for now while
 * the feature is redesigned; the code stays so turning it back on is this one line.
 * Smooth scrubbing does not depend on it.
 */
const FRAME_TOOLS = false;

const SEEK_STEP_SECONDS = 5;
const BAR_HEIGHT = 36;
/** Below this player width the frame-step buttons give their room back to the slider. */
const STEP_BUTTONS_MIN_PX = 300;
const TOAST_MS = 1_800;
/** Above Instagram's click-catcher — only needed for the native control strip. */
const NATIVE_Z_INDEX = '2147483000';
const BAR_Z_INDEX = '2147483002';
/** Instagram ships 1px tracking pixels as <video>; ignore anything that small. */
const MIN_VIDEO_PX = 120;

const ICON_PLAY = '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M6.5 5h3.5v14H6.5zM14 5h3.5v14H14z"/></svg>';
const ICON_SOUND = '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M4 9.5v5h3.5L12 18V6L7.5 9.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
const ICON_PREV_FRAME = '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M6 6h2v12H6zM18 6v12l-8.5-6z"/></svg>';
const ICON_NEXT_FRAME = '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M16 6h2v12h-2zM6 6v12l8.5-6z"/></svg>';
const ICON_CAMERA = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M4 8.5h3l1.6-2.5h6.8L17 8.5h3v10H4z"/><circle cx="12" cy="13.2" r="3.3"/></svg>';
const ICON_MUTED = '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M4 9.5v5h3.5L12 18V6L7.5 9.5H4z"/><path d="M15.5 9.5l4 5M19.5 9.5l-4 5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';

const enhanced = new WeakSet<HTMLVideoElement>();

/**
 * Players the user has explicitly unmuted through our bar.
 *
 * Instagram re-mutes as part of its own play/pause handling — autoplay policy only lets
 * it start a muted video, and the same helper runs when you resume one by hand. The
 * effect is that sound has to be turned on again after every pause. We remember the
 * intent and put it back.
 *
 * Per player rather than global: scrolling from a reel you unmuted to the next one should
 * not start playing audio you never asked for.
 */
const wantsSound = new WeakSet<HTMLVideoElement>();

/**
 * How long after a play/pause a mute is treated as Instagram's doing rather than yours.
 * Without this window we would also undo a deliberate mute made mid-playback, whether
 * through our button or theirs.
 */
const REASSERT_WINDOW_MS = 600;

/**
 * The newest seek target waiting behind one already in flight, per video. Applied on
 * `seeked`, so a burst of seeks decodes at most two frames instead of none.
 */
const queuedSeek = new WeakMap<HTMLVideoElement, number>();
/** The last target asked of each video, for stepping again before a seek lands. */
const requestedSeek = new WeakMap<HTMLVideoElement, number>();

let mode: VideoControls = 'overlay';
let bar: ControlBar | null = null;
let scanQueued = false;
let pointerX = -1;
let pointerY = -1;

/**
 * storage.onChanged hands us the raw stored value, which on a profile that predates the
 * rename is still 'thin'. Anything that isn't explicitly 'native' means our own bar.
 */
function normalize(value: string | undefined): VideoControls {
  return value === 'native' ? 'native' : 'overlay';
}

export function startVideoControls(initial: string | undefined): void {
  mode = normalize(initial);
  scan();

  new MutationObserver(queueScan).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  document.addEventListener('keydown', onKeyDown, true);
  // Capture phase: Instagram's click-catcher stops propagation on plenty of pointer
  // events, and a capture listener sees them before it can.
  document.addEventListener('pointermove', onPointerMove, { capture: true, passive: true });
  // Fires once when the cursor leaves the document, unlike pointerleave, which fires for
  // every element on the way out.
  document.addEventListener('mouseleave', forgetPointer, { passive: true });
  // Nothing re-targeted on scroll, so wheel-scrolling without moving the mouse left the
  // bar driving a player that had already left the viewport.
  document.addEventListener('scroll', queueRetarget, { capture: true, passive: true });
  document.addEventListener('fullscreenchange', () => {
    scan();
    queueRetarget();
  });
}

export function setScrubberSkin(raw: string | undefined): void {
  const next = normalize(raw);
  if (next === mode) return;
  mode = next;
  if (mode === 'native') {
    bar?.destroy();
    bar = null;
  }
  for (const video of document.querySelectorAll('video')) applyFlags(video);
  queueRetarget();
}

// --- flags ------------------------------------------------------------------

function queueScan(): void {
  if (scanQueued) return;
  scanQueued = true;
  requestAnimationFrame(() => {
    scanQueued = false;
    scan();
  });
}

function scan(): void {
  for (const video of document.querySelectorAll('video')) enhance(video);
}

function enhance(video: HTMLVideoElement): void {
  // After the early return, not before. The per-video observer below already re-applies
  // the flags on every attribute React touches, so re-flagging here on every mutation
  // frame of a page that mutates constantly was pure repetition.
  if (enhanced.has(video)) return;
  enhanced.add(video);
  applyFlags(video);

  // React re-renders reset these attributes; a one-shot pass loses within seconds.
  new MutationObserver(() => applyFlags(video)).observe(video, {
    attributes: true,
    attributeFilter: ['controls', 'controlslist', 'disablepictureinpicture', 'loop', 'style'],
  });

  keepSoundOn(video);
  video.addEventListener('seeked', () => {
    const next = queuedSeek.get(video);
    if (next === undefined) return;
    queuedSeek.delete(video);
    video.currentTime = next;
  });
}

/** Seek without abandoning one already decoding; see the file comment. */
function seek(video: HTMLVideoElement, seconds: number): void {
  requestedSeek.set(video, seconds);
  if (video.seeking) queuedSeek.set(video, seconds);
  else video.currentTime = seconds;
}

/**
 * Put the user's unmute back after Instagram's play/pause handling drops it.
 *
 * The ordering is either way round depending on the build — they sometimes mute before
 * calling `play()`, sometimes just after — so both the transition itself and any
 * `volumechange` shortly after it get a look. `muted = false` fires another
 * `volumechange`, but by then `video.muted` is false and the guard ends the chain.
 */
function keepSoundOn(video: HTMLVideoElement): void {
  let lastTransition = 0;

  const restore = (): void => {
    if (wantsSound.has(video) && video.muted) video.muted = false;
  };

  const onTransition = (): void => {
    lastTransition = performance.now();
    restore();
  };

  for (const type of ['play', 'playing', 'pause'] as const) {
    video.addEventListener(type, onTransition);
  }
  video.addEventListener('volumechange', () => {
    if (performance.now() - lastTransition < REASSERT_WINDOW_MS) restore();
  });
}

function applyFlags(video: HTMLVideoElement): void {
  // A fullscreen element renders in the browser's top layer, above every z-index, and our
  // bar lives in document.body rather than inside that subtree — so suppressing the native
  // strip in fullscreen left the video with no controls at all.
  const fullscreen = document.fullscreenElement;
  const wantNative =
    mode === 'native' || fullscreen === video || Boolean(fullscreen?.contains(video));
  if (video.controls !== wantNative) video.controls = wantNative;

  video.removeAttribute('controlslist');
  video.removeAttribute('disablepictureinpicture');
  video.disablePictureInPicture = false;

  // Looping hides where the end is and restarts under you mid-scrub.
  if (video.loop) video.loop = false;

  if (wantNative) {
    if (video.style.zIndex !== NATIVE_Z_INDEX) {
      video.style.zIndex = NATIVE_Z_INDEX;
      if (getComputedStyle(video).position === 'static') video.style.position = 'relative';
    }
  } else if (video.style.zIndex === NATIVE_Z_INDEX) {
    // Our own bar sits outside their DOM, so leave their layout alone.
    video.style.zIndex = '';
  }
}

// --- pointer tracking and targeting -----------------------------------------

function onPointerMove(ev: PointerEvent): void {
  // Hover-capable pointers only. A touch drag set these coordinates and nothing ever
  // cleared them, so on a touchscreen the bar latched onto a video permanently — holding
  // a 60fps rAF loop and eating a 36px strip of the page's own scrolling.
  if (ev.pointerType === 'touch') return;
  pointerX = ev.clientX;
  pointerY = ev.clientY;
  queueRetarget();
}

function forgetPointer(): void {
  pointerX = -1;
  pointerY = -1;
  queueRetarget();
}

/** pointermove fires far faster than we need to re-run a layout-reading hit test. */
let retargetQueued = false;

function queueRetarget(): void {
  if (retargetQueued) return;
  retargetQueued = true;
  requestAnimationFrame(() => {
    retargetQueued = false;
    retarget();
  });
}

/**
 * True when the library overlay is what the cursor is actually on. It takes no pointer
 * events while hidden, so `elementFromPoint` answers this on its own.
 */
function pointerOverLibrary(): boolean {
  if (pointerX < 0) return false;
  const top = document.elementFromPoint(pointerX, pointerY);
  return top?.getAttribute('data-saved-index') === 'library';
}

/** The smallest visible player whose box contains the cursor — nested players win. */
function videoUnderPointer(): HTMLVideoElement | null {
  if (pointerX < 0) return null;

  let best: HTMLVideoElement | null = null;
  let bestArea = Infinity;

  for (const video of document.querySelectorAll('video')) {
    const r = video.getBoundingClientRect();
    if (r.width < MIN_VIDEO_PX || r.height < MIN_VIDEO_PX) continue;
    if (pointerX < r.left || pointerX > r.right) continue;
    if (pointerY < r.top || pointerY > r.bottom) continue;

    const area = r.width * r.height;
    if (area < bestArea) {
      bestArea = area;
      best = video;
    }
  }
  return best;
}

function retarget(): void {
  if (mode !== 'overlay') return;
  if (bar?.isBusy()) return; // never yank the bar out from under a drag

  // Cheap test first. `pointerOverLibrary` calls elementFromPoint, which forces a layout
  // flush, and running it unconditionally meant paying for one on every moved frame of
  // every Instagram page — including the overwhelming majority where the library is not
  // mounted and the answer is always no.
  const video = videoUnderPointer();
  if (!video) return void bar?.hide();

  // Targeting is geometric, so a player *behind* the library would still be "under" the
  // cursor. Nothing back there is reachable, so a bar floating over the library would be
  // pure artefact.
  if (pointerOverLibrary()) return void bar?.hide();

  bar ??= new ControlBar();
  bar.attach(video);
}

// --- keyboard ---------------------------------------------------------------

function onKeyDown(ev: KeyboardEvent): void {
  const step = !FRAME_TOOLS ? 0 : ev.key === ',' ? -1 : ev.key === '.' ? 1 : 0;
  if (!step && ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
  // Never steal keys from a text field or Instagram's own story navigation. The
  // library's search box lives in a shadow root, where `ev.target` retargets to the host
  // — composedPath()[0] is the node actually focused, so arrows there move the caret.
  const target = (ev.composedPath()[0] ?? ev.target) as HTMLElement | null;
  if (target?.isContentEditable) return;
  if (target?.tagName && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

  // Only the player under the cursor. The old fallback to "the largest visible video"
  // meant that in the story viewer — where focus sits on <body> and a story is by
  // definition the largest video on screen — ArrowRight scrubbed the current story
  // forward instead of advancing to the next one, from a capture-phase listener that
  // called stopPropagation so Instagram never saw the key. Same for carousel slides.
  const video = videoUnderPointer();
  if (!video || !Number.isFinite(video.duration)) return;

  ev.preventDefault();
  ev.stopPropagation();
  if (step) return stepFrame(video, step);
  const delta = ev.key === 'ArrowRight' ? SEEK_STEP_SECONDS : -SEEK_STEP_SECONDS;
  seek(video, clamp((requestedSeekIfPending(video) ?? video.currentTime) + delta, 0, video.duration));
}

// --- frames -----------------------------------------------------------------

/**
 * What the browser has told us about one player's frames: the start of the frame on
 * screen, and recent gaps between frames during playback, from which frames.ts learns
 * the frame length.
 */
interface FrameClock {
  frameStart: number | null;
  /** False from a `seeked` until the frame it landed on has been presented. */
  fresh: boolean;
  presented: number;
  gaps: number[];
  handle: number;
}

const clocks = new WeakMap<HTMLVideoElement, FrameClock>();
const MAX_GAPS = 12;

/** Follow presented frames while the bar is on this player. */
function watchFrames(video: HTMLVideoElement): void {
  if (typeof video.requestVideoFrameCallback !== 'function') return;
  let clock = clocks.get(video);
  if (!clock) {
    const created: FrameClock = { frameStart: null, fresh: false, presented: 0, gaps: [], handle: 0 };
    video.addEventListener('seeked', () => {
      created.fresh = false;
    });
    clocks.set(video, created);
    clock = created;
  }
  if (clock.handle) return;

  const c = clock;
  const onFrame = (_now: number, meta: VideoFrameCallbackMetadata): void => {
    // Only consecutive frames during playback measure the frame length; a seek or a
    // dropped frame would not.
    if (c.frameStart !== null && meta.presentedFrames === c.presented + 1 && !video.paused && !video.seeking) {
      c.gaps.push(meta.mediaTime - c.frameStart);
      if (c.gaps.length > MAX_GAPS) c.gaps.shift();
    }
    c.frameStart = meta.mediaTime;
    c.presented = meta.presentedFrames;
    c.fresh = true;
    c.handle = video.requestVideoFrameCallback(onFrame);
  };
  c.handle = video.requestVideoFrameCallback(onFrame);
}

function unwatchFrames(video: HTMLVideoElement): void {
  const clock = clocks.get(video);
  if (!clock?.handle) return;
  video.cancelVideoFrameCallback(clock.handle);
  clock.handle = 0;
}

/** The target of a seek that has not landed yet, so repeated steps build on each other. */
function requestedSeekIfPending(video: HTMLVideoElement): number | undefined {
  const landed = !video.seeking && !queuedSeek.has(video) && clocks.get(video)?.fresh !== false;
  return landed ? undefined : requestedSeek.get(video);
}

/** Pause and show the neighbouring frame. Holding the key steps continuously. */
function stepFrame(video: HTMLVideoElement, direction: 1 | -1): void {
  if (!Number.isFinite(video.duration)) return;
  if (!video.paused) video.pause();

  const clock = clocks.get(video);
  const frame = frameDuration(clock?.gaps ?? []);
  const pending = requestedSeekIfPending(video);
  const anchor =
    pending !== undefined
      ? pending - frame / 2
      : clock?.fresh && clock.frameStart !== null
        ? clock.frameStart
        : Math.floor(video.currentTime / frame + 1e-6) * frame;
  seek(video, stepTarget(anchor, frame, direction, video.duration));
}

/**
 * The timestamp of the frame on screen. `currentTime` can sit just before it after a
 * pause, which would name a still after the frame before the one it shows.
 */
function shownAt(video: HTMLVideoElement): number {
  const clock = clocks.get(video);
  return clock?.fresh && clock.frameStart !== null ? clock.frameStart : video.currentTime;
}

/** The post a player belongs to: the open post's URL, or the feed card it sits in. */
function shortcodeOf(video: HTMLVideoElement): string | null {
  const link = video.closest('article')?.querySelector('a[href*="/p/"], a[href*="/reel/"]');
  return shortcodeFrom(location.pathname) ?? shortcodeFrom(link?.getAttribute('href') ?? '');
}

/**
 * The frame on screen as a PNG at the video's own resolution, not the size it is shown
 * at. Drawing reads the element; it does not seek, pause or reload it.
 */
async function grabFrame(video: HTMLVideoElement): Promise<Blob | string> {
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth) {
    return 'This frame hasn’t loaded yet.';
  }
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return 'Couldn’t capture this frame.';
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  try {
    // Throws when the video came straight from another origin without CORS. Instagram's
    // players stream through MediaSource, which is same-origin, so this is the exception.
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    return blob ?? 'Couldn’t capture this frame.';
  } catch {
    return 'This video can’t be captured.';
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

// --- the control bar --------------------------------------------------------

/**
 * One reusable bar, repositioned over whichever player the cursor is on. Lives in
 * `document.body` so React never tears it out and no stacking context can bury it; the
 * cost is re-reading the video's rect each frame, which only happens while attached.
 */
class ControlBar {
  private readonly root = document.createElement('div');
  private readonly playBtn = document.createElement('button');
  private readonly prevBtn = document.createElement('button');
  private readonly nextBtn = document.createElement('button');
  private readonly shotBtn = document.createElement('button');
  private readonly muteBtn = document.createElement('button');
  private readonly time = document.createElement('span');
  private readonly hit = document.createElement('div');
  private readonly track = document.createElement('div');
  private readonly fill = document.createElement('div');
  private readonly knob = document.createElement('div');
  private readonly toast = document.createElement('div');

  private video: HTMLVideoElement | null = null;
  private dragging = false;
  /** Where the pointer is on the track while dragging, 0–1. Painted instead of the playhead. */
  private dragAt = 0;
  private resumeAfterDrag = false;
  private hovering = false;
  private raf = 0;
  private toastTimer = 0;
  // paint() runs every frame; these keep it from rewriting markup that hasn't changed.
  private shownPaused: boolean | null = null;
  private shownMuted: boolean | null = null;
  private shownTime = '';
  private shownSteps: boolean | null = null;

  constructor() {
    Object.assign(this.root.style, {
      position: 'fixed',
      display: 'none',
      alignItems: 'center',
      gap: '6px',
      boxSizing: 'border-box',
      height: `${BAR_HEIGHT}px`,
      padding: '0 10px',
      zIndex: BAR_Z_INDEX,
      background: 'linear-gradient(to top, rgba(0,0,0,0.68), rgba(0,0,0,0.18))',
      color: '#fff',
      font: '400 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace',
      letterSpacing: '0.04em',
      touchAction: 'none',
      userSelect: 'none',
      webkitUserSelect: 'none',
    } satisfies Partial<CSSStyleDeclaration>);
    this.root.setAttribute('data-saved-index', 'video-controls');

    const buttons: [HTMLButtonElement, string, string][] = [
      [this.playBtn, ICON_PLAY, 'Play'],
      [this.prevBtn, ICON_PREV_FRAME, 'Previous frame ( , )'],
      [this.nextBtn, ICON_NEXT_FRAME, 'Next frame ( . )'],
      [this.shotBtn, ICON_CAMERA, 'Save this frame · Shift-click to copy it'],
      [this.muteBtn, ICON_SOUND, 'Mute'],
    ];
    for (const [btn, icon, title] of buttons) {
      Object.assign(btn.style, {
        all: 'unset',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '24px',
        height: '24px',
        flex: 'none',
        borderRadius: '6px',
        color: '#fff',
        cursor: 'pointer',
        opacity: '0.9',
        transition: 'background 110ms ease',
      } satisfies Partial<CSSStyleDeclaration>);
      btn.innerHTML = icon;
      btn.title = title;
      btn.setAttribute('aria-label', title);
      btn.addEventListener('pointerenter', () => (btn.style.background = 'rgba(255,255,255,0.16)'));
      btn.addEventListener('pointerleave', () => (btn.style.background = ''));
    }

    Object.assign(this.time.style, {
      flex: 'none',
      margin: '0 4px',
      opacity: '0.85',
      fontVariantNumeric: 'tabular-nums',
    } satisfies Partial<CSSStyleDeclaration>);

    // A tall invisible strip around a thin visible track: easy to grab, quiet at rest.
    Object.assign(this.hit.style, {
      position: 'relative',
      flex: '1',
      minWidth: '40px',
      height: '24px',
      display: 'flex',
      alignItems: 'center',
      cursor: 'pointer',
    } satisfies Partial<CSSStyleDeclaration>);

    Object.assign(this.track.style, {
      position: 'relative',
      width: '100%',
      height: '3px',
      borderRadius: '2px',
      background: 'rgba(255,255,255,0.28)',
      transition: 'height 110ms ease',
    } satisfies Partial<CSSStyleDeclaration>);

    Object.assign(this.fill.style, {
      position: 'absolute',
      inset: '0 auto 0 0',
      width: '0%',
      borderRadius: 'inherit',
      background: '#fff',
    } satisfies Partial<CSSStyleDeclaration>);

    Object.assign(this.knob.style, {
      position: 'absolute',
      top: '50%',
      left: '0%',
      width: '11px',
      height: '11px',
      marginLeft: '-5.5px',
      marginTop: '-5.5px',
      borderRadius: '50%',
      background: '#fff',
      boxShadow: '0 1px 4px rgba(0,0,0,0.5)',
      opacity: '0',
      transition: 'opacity 110ms ease',
      pointerEvents: 'none',
    } satisfies Partial<CSSStyleDeclaration>);

    Object.assign(this.toast.style, {
      position: 'absolute',
      right: '10px',
      bottom: `${BAR_HEIGHT + 6}px`,
      padding: '6px 10px',
      borderRadius: '8px',
      background: 'rgba(20,20,22,0.82)',
      backdropFilter: 'blur(8px)',
      font: '500 12px/1.2 system-ui, -apple-system, sans-serif',
      letterSpacing: '0',
      whiteSpace: 'nowrap',
      opacity: '0',
      transform: 'translateY(4px)',
      transition: 'opacity 160ms ease, transform 160ms ease',
      pointerEvents: 'none',
    } satisfies Partial<CSSStyleDeclaration>);
    this.toast.setAttribute('role', 'status');

    this.track.append(this.fill, this.knob);
    this.hit.append(this.track);
    this.root.append(
      this.playBtn,
      ...(FRAME_TOOLS ? [this.prevBtn, this.nextBtn] : []),
      this.time,
      this.hit,
      ...(FRAME_TOOLS ? [this.shotBtn] : []),
      this.muteBtn,
      this.toast,
    );
    document.body.appendChild(this.root);

    this.root.addEventListener('pointerenter', () => {
      this.hovering = true;
      this.paint();
    });
    this.root.addEventListener('pointerleave', () => {
      this.hovering = false;
      this.paint();
    });

    // Instagram delegates through React's root container, which is not an ancestor of
    // this node, so its handlers never fire here. Stopping propagation anyway covers the
    // handful of listeners they bind directly to document.
    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick']) {
      this.root.addEventListener(type, (ev) => ev.stopPropagation());
    }

    this.playBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      const video = this.video;
      if (!video) return;
      void (video.paused ? video.play().catch(() => {}) : video.pause());
      this.paint();
    });

    this.prevBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      if (this.video) stepFrame(this.video, -1);
    });
    this.nextBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      if (this.video) stepFrame(this.video, 1);
    });

    this.shotBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      if (this.video) void this.capture(this.video, ev.shiftKey);
    });

    this.muteBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      const video = this.video;
      if (!video) return;
      // This button is the only thing that sets the intent, so muting here is final —
      // we will not turn the sound back on behind your back.
      const nextMuted = !video.muted;
      video.muted = nextMuted;
      if (nextMuted) wantsSound.delete(video);
      else wantsSound.add(video);
      this.paint();
    });

    this.hit.addEventListener('pointerdown', this.onDown);
  }

  isBusy(): boolean {
    return this.dragging || this.hovering;
  }

  attach(video: HTMLVideoElement): void {
    if (this.video === video) return;
    if (this.video) unwatchFrames(this.video);
    this.video = video;
    watchFrames(video);
    this.root.style.display = 'flex';
    cancelAnimationFrame(this.raf);
    this.tick();
  }

  hide(): void {
    if (this.dragging) return;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.video) unwatchFrames(this.video);
    this.video = null;
    // Hiding the node means its pointerleave will never arrive; without this, `isBusy`
    // would stay true and retarget would refuse to bind anything again.
    this.hovering = false;
    this.root.style.display = 'none';
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    if (this.video) unwatchFrames(this.video);
    this.root.remove();
    this.video = null;
  }

  /** Download the frame on screen, or with `copy`, put it on the clipboard. */
  private async capture(video: HTMLVideoElement, copy: boolean): Promise<void> {
    const shot = await grabFrame(video);
    if (typeof shot === 'string') return this.say(shot);
    const size = `${video.videoWidth} × ${video.videoHeight}`;

    if (copy) {
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': shot })]);
        return this.say(`Copied · ${size}`);
      } catch {
        return this.say('Couldn’t copy. Click to download instead.');
      }
    }

    // The link lives inside the bar, so its click stops here like every other click on
    // the bar and never reaches the post underneath.
    const url = URL.createObjectURL(shot);
    const link = document.createElement('a');
    link.href = url;
    link.download = frameFilename(shortcodeOf(video), shownAt(video));
    link.hidden = true;
    this.root.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    this.say(`Saved · ${size}`);
  }

  private say(message: string): void {
    this.toast.textContent = message;
    this.toast.style.opacity = '1';
    this.toast.style.transform = 'translateY(0)';
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toast.style.opacity = '0';
      this.toast.style.transform = 'translateY(4px)';
    }, TOAST_MS);
  }

  /** Follow the player's rect and playhead. Only runs while attached. */
  private tick = (): void => {
    const video = this.video;
    if (!video || !video.isConnected) return this.hide();

    const r = video.getBoundingClientRect();
    const gone = r.width < MIN_VIDEO_PX || r.bottom < 0 || r.top > window.innerHeight;
    if (gone) return this.hide();

    // Sit inside the player's bottom edge, so the cursor is still within the video's
    // rect while it is on the bar and `retarget` doesn't immediately drop it.
    this.root.style.left = `${r.left}px`;
    this.root.style.width = `${r.width}px`;
    // The clamp keeps the bar on screen. Clamping to the very bottom put it straight on
    // top of Instagram's own caption, audio row and progress line on any viewport-height
    // player — i.e. on every reel — and our stopPropagation handlers then swallowed the
    // clicks meant for them.
    this.root.style.top = `${Math.max(
      0,
      Math.min(
        r.bottom - BAR_HEIGHT,
        window.innerHeight - BAR_HEIGHT - BOTTOM_KEEP_OUT_PX,
      ),
    )}px`;

    const steps = FRAME_TOOLS && r.width >= STEP_BUTTONS_MIN_PX;
    if (this.shownSteps !== steps) {
      this.shownSteps = steps;
      this.prevBtn.style.display = this.nextBtn.style.display = steps ? 'flex' : 'none';
    }

    this.paint();
    this.raf = requestAnimationFrame(this.tick);
  };

  private paint(): void {
    const video = this.video;
    if (!video) return;

    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    // While dragging, the slider is where the pointer is; the picture catches up behind.
    const at = this.dragging ? this.dragAt * duration : video.currentTime;
    const pct = duration > 0 ? clamp(at / duration, 0, 1) * 100 : 0;
    const active = this.hovering || this.dragging;

    this.track.style.height = active ? '5px' : '3px';
    this.fill.style.width = `${pct}%`;
    this.knob.style.left = `${pct}%`;
    this.knob.style.opacity = active ? '1' : '0';

    if (this.shownPaused !== video.paused) {
      this.shownPaused = video.paused;
      this.playBtn.innerHTML = video.paused ? ICON_PLAY : ICON_PAUSE;
      this.playBtn.title = video.paused ? 'Play' : 'Pause';
    }
    if (this.shownMuted !== video.muted) {
      this.shownMuted = video.muted;
      this.muteBtn.innerHTML = video.muted ? ICON_MUTED : ICON_SOUND;
      this.muteBtn.title = video.muted ? 'Unmute' : 'Mute';
    }
    // Hundredths only when still: enough to tell frames apart, without a blur of digits
    // during playback.
    const precise = video.paused || this.dragging;
    const label = `${timecode(at, precise)} / ${timecode(duration)}`;
    if (this.shownTime !== label) {
      this.shownTime = label;
      this.time.textContent = label;
    }
  }

  private onDown = (ev: PointerEvent): void => {
    const video = this.video;
    if (!video) return;
    ev.preventDefault();
    ev.stopPropagation();

    this.dragging = true;
    // A playing video fights the drag for the decoder; hold it still and carry on after.
    this.resumeAfterDrag = !video.paused;
    if (this.resumeAfterDrag) video.pause();
    this.hit.setPointerCapture(ev.pointerId);
    this.seekTo(ev.clientX);

    this.hit.addEventListener('pointermove', this.onMove);
    this.hit.addEventListener('pointerup', this.onUp, { once: true });
    this.hit.addEventListener('pointercancel', this.onUp, { once: true });
  };

  private onMove = (ev: PointerEvent): void => {
    if (this.dragging) this.seekTo(ev.clientX);
  };

  private onUp = (): void => {
    this.dragging = false;
    this.hit.removeEventListener('pointermove', this.onMove);
    if (this.resumeAfterDrag) void this.video?.play().catch(() => {});
    this.resumeAfterDrag = false;
    // A drag ends in a click. Swallow exactly one, or releasing the scrubber opens the
    // post underneath.
    window.addEventListener('click', swallowOnce, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', swallowOnce, { capture: true }), 0);
    this.paint();
  };

  private seekTo(clientX: number): void {
    const video = this.video;
    if (!video || !Number.isFinite(video.duration)) return;
    const r = this.track.getBoundingClientRect();
    if (r.width === 0) return;
    this.dragAt = clamp((clientX - r.left) / r.width, 0, 1);
    seek(video, this.dragAt * video.duration);
    this.paint();
  }
}

function swallowOnce(ev: Event): void {
  ev.stopPropagation();
  ev.preventDefault();
}

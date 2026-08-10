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
 */

import type { VideoControls } from '../types';

const SEEK_STEP_SECONDS = 5;
const BAR_HEIGHT = 36;
/** Above Instagram's click-catcher — only needed for the native control strip. */
const NATIVE_Z_INDEX = '2147483000';
const BAR_Z_INDEX = '2147483002';
/** Instagram ships 1px tracking pixels as <video>; ignore anything that small. */
const MIN_VIDEO_PX = 120;

const ICON_PLAY = '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M6.5 5h3.5v14H6.5zM14 5h3.5v14H14z"/></svg>';
const ICON_SOUND = '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M4 9.5v5h3.5L12 18V6L7.5 9.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
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
  applyFlags(video);
  if (enhanced.has(video)) return;
  enhanced.add(video);

  // React re-renders reset these attributes; a one-shot pass loses within seconds.
  new MutationObserver(() => applyFlags(video)).observe(video, {
    attributes: true,
    attributeFilter: ['controls', 'controlslist', 'disablepictureinpicture', 'loop', 'style'],
  });

  keepSoundOn(video);
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
  const wantNative = mode === 'native';
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
  // Targeting is geometric, so a player *behind* the library would still be "under" the
  // cursor. Nothing back there is reachable, so a bar floating over the library would be
  // pure artefact.
  if (pointerOverLibrary()) return void bar?.hide();

  const video = videoUnderPointer();
  if (!video) return void bar?.hide();

  bar ??= new ControlBar();
  bar.attach(video);
}

// --- keyboard ---------------------------------------------------------------

function onKeyDown(ev: KeyboardEvent): void {
  if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
  // Never steal arrows from a text field or Instagram's own story navigation. The
  // library's search box lives in a shadow root, where `ev.target` retargets to the host
  // — composedPath()[0] is the node actually focused, so arrows there move the caret.
  const target = (ev.composedPath()[0] ?? ev.target) as HTMLElement | null;
  if (target?.isContentEditable) return;
  if (target?.tagName && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

  const video = videoUnderPointer() ?? largestVisibleVideo();
  if (!video || !Number.isFinite(video.duration)) return;

  ev.preventDefault();
  ev.stopPropagation();
  const delta = ev.key === 'ArrowRight' ? SEEK_STEP_SECONDS : -SEEK_STEP_SECONDS;
  video.currentTime = clamp(video.currentTime + delta, 0, video.duration);
}

function largestVisibleVideo(): HTMLVideoElement | null {
  let best: HTMLVideoElement | null = null;
  let bestArea = 0;

  for (const video of document.querySelectorAll('video')) {
    const r = video.getBoundingClientRect();
    if (r.width < MIN_VIDEO_PX || r.bottom < 0 || r.top > window.innerHeight) continue;
    const area = r.width * r.height;
    if (area > bestArea) {
      bestArea = area;
      best = video;
    }
  }
  return best;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function fmt(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
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
  private readonly muteBtn = document.createElement('button');
  private readonly time = document.createElement('span');
  private readonly hit = document.createElement('div');
  private readonly track = document.createElement('div');
  private readonly fill = document.createElement('div');
  private readonly knob = document.createElement('div');

  private video: HTMLVideoElement | null = null;
  private dragging = false;
  private hovering = false;
  private raf = 0;
  // paint() runs every frame; these keep it from rewriting markup that hasn't changed.
  private shownPaused: boolean | null = null;
  private shownMuted: boolean | null = null;
  private shownTime = '';

  constructor() {
    Object.assign(this.root.style, {
      position: 'fixed',
      display: 'none',
      alignItems: 'center',
      gap: '10px',
      boxSizing: 'border-box',
      height: `${BAR_HEIGHT}px`,
      padding: '0 12px',
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

    for (const btn of [this.playBtn, this.muteBtn]) {
      Object.assign(btn.style, {
        all: 'unset',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '20px',
        height: '20px',
        flex: 'none',
        color: '#fff',
        cursor: 'pointer',
        opacity: '0.9',
      } satisfies Partial<CSSStyleDeclaration>);
    }
    this.playBtn.innerHTML = ICON_PLAY;
    this.muteBtn.innerHTML = ICON_SOUND;

    Object.assign(this.time.style, {
      flex: 'none',
      opacity: '0.85',
      fontVariantNumeric: 'tabular-nums',
    } satisfies Partial<CSSStyleDeclaration>);

    // A tall invisible strip around a thin visible track: easy to grab, quiet at rest.
    Object.assign(this.hit.style, {
      position: 'relative',
      flex: '1',
      height: '18px',
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

    this.track.append(this.fill, this.knob);
    this.hit.append(this.track);
    this.root.append(this.playBtn, this.time, this.hit, this.muteBtn);
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
    this.video = video;
    this.root.style.display = 'flex';
    cancelAnimationFrame(this.raf);
    this.tick();
  }

  hide(): void {
    if (this.dragging) return;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.video = null;
    // Hiding the node means its pointerleave will never arrive; without this, `isBusy`
    // would stay true and retarget would refuse to bind anything again.
    this.hovering = false;
    this.root.style.display = 'none';
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.root.remove();
    this.video = null;
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
    this.root.style.top = `${Math.min(r.bottom - BAR_HEIGHT, window.innerHeight - BAR_HEIGHT)}px`;

    this.paint();
    this.raf = requestAnimationFrame(this.tick);
  };

  private paint(): void {
    const video = this.video;
    if (!video) return;

    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const pct = duration > 0 ? clamp(video.currentTime / duration, 0, 1) * 100 : 0;
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
    const label = `${fmt(video.currentTime)} / ${fmt(duration)}`;
    if (this.shownTime !== label) {
      this.shownTime = label;
      this.time.textContent = label;
    }
  }

  private onDown = (ev: PointerEvent): void => {
    if (!this.video) return;
    ev.preventDefault();
    ev.stopPropagation();

    this.dragging = true;
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
    video.currentTime = clamp((clientX - r.left) / r.width, 0, 1) * video.duration;
    this.paint();
  }
}

function swallowOnce(ev: Event): void {
  ev.stopPropagation();
  ev.preventDefault();
}

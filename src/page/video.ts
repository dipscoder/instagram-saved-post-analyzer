/**
 * Real seek controls on Instagram videos.
 *
 * Instagram ships videos with `controls` off, a click-catcher overlay above the player,
 * and `loop` on, so there is no way to scrub and no way to tell how long a reel is. This
 * puts that back.
 *
 * Two skins, chosen in settings:
 *   native — the browser's own control bar (default)
 *   thin   — a 3px scrubber flush to the bottom edge, per the design doc
 *
 * React re-renders wipe our attributes within seconds, so a single pass is not enough:
 * every video gets its own attribute observer that re-applies them, and a document-level
 * observer catches videos that appear later. Both funnel through one rAF-throttled scan
 * so a mutation storm costs one pass per frame rather than one per mutation.
 */

import type { VideoControls } from '../types';

const SEEK_STEP_SECONDS = 5;
/** Above Instagram's click-catcher, below nothing of ours. */
const VIDEO_Z_INDEX = '2147483000';

const enhanced = new WeakSet<HTMLVideoElement>();
let skin: VideoControls = 'overlay';
let scanQueued = false;
let scrubber: ThinScrubber | null = null;

export function startVideoControls(initialSkin: VideoControls): void {
  skin = initialSkin;

  scan();

  new MutationObserver(queueScan).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  document.addEventListener('keydown', onKeyDown, true);
}

export function setScrubberSkin(next: VideoControls): void {
  if (next === skin) return;
  skin = next;
  if (skin === 'native') {
    scrubber?.destroy();
    scrubber = null;
  }
  // Re-apply to everything on screen; `enhanced` only guards observer setup.
  for (const v of document.querySelectorAll('video')) applyFlags(v);
  queueScan();
}

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

  // Per-video watch: React re-renders reset these attributes, and a one-shot pass
  // loses that fight within seconds.
  new MutationObserver(() => applyFlags(video)).observe(video, {
    attributes: true,
    attributeFilter: ['controls', 'controlslist', 'disablepictureinpicture', 'loop', 'style'],
  });

  // Always attached, and gated at call time — a listener added only while the thin skin
  // was active would leave videos enhanced before a settings change without one.
  video.addEventListener('pointerenter', () => {
    if (skin === 'overlay') bindScrubber(video);
  });
}

function applyFlags(video: HTMLVideoElement): void {
  const wantControls = skin === 'native';
  if (video.controls !== wantControls) video.controls = wantControls;

  video.removeAttribute('controlslist');
  video.removeAttribute('disablepictureinpicture');
  video.disablePictureInPicture = false;

  // Looping makes it impossible to tell where the end is, and restarts under you
  // mid-scrub.
  if (video.loop) video.loop = false;

  // Lift the player above Instagram's click-catcher so scrubber clicks reach the
  // video instead of opening the post.
  if (video.style.zIndex !== VIDEO_Z_INDEX) {
    video.style.zIndex = VIDEO_Z_INDEX;
    if (getComputedStyle(video).position === 'static') video.style.position = 'relative';
  }
}

function bindScrubber(video: HTMLVideoElement): void {
  scrubber ??= new ThinScrubber();
  scrubber.bind(video);
}

// --- keyboard ---------------------------------------------------------------

function onKeyDown(ev: KeyboardEvent): void {
  if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
  // Never steal arrows from a text field or Instagram's own story navigation input.
  const target = ev.target as HTMLElement | null;
  if (target?.isContentEditable) return;
  if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

  const video = activeVideo();
  if (!video || !Number.isFinite(video.duration)) return;

  ev.preventDefault();
  ev.stopPropagation();
  const delta = ev.key === 'ArrowRight' ? SEEK_STEP_SECONDS : -SEEK_STEP_SECONDS;
  video.currentTime = clamp(video.currentTime + delta, 0, video.duration);
}

/** The video under the pointer if there is one, else the largest one on screen. */
let pointerX = 0;
let pointerY = 0;
document.addEventListener(
  'pointermove',
  (e) => {
    pointerX = e.clientX;
    pointerY = e.clientY;
  },
  { passive: true },
);

function activeVideo(): HTMLVideoElement | null {
  const videos = [...document.querySelectorAll('video')];
  let best: HTMLVideoElement | null = null;
  let bestArea = 0;

  for (const v of videos) {
    const r = v.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.bottom < 0 || r.top > window.innerHeight) continue;

    const under =
      pointerX >= r.left && pointerX <= r.right && pointerY >= r.top && pointerY <= r.bottom;
    if (under) return v;

    const area = r.width * r.height;
    if (area > bestArea) {
      bestArea = area;
      best = v;
    }
  }
  return best;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

// --- thin scrubber skin -----------------------------------------------------

/**
 * A single overlay reused across videos, positioned over whichever one you're pointing
 * at. Rendering into document.body rather than Instagram's DOM means React never sees
 * our nodes and never tears them out; the cost is tracking the video's rect each frame,
 * which we only do while bound.
 */
class ThinScrubber {
  private readonly root: HTMLDivElement;
  private readonly track: HTMLDivElement;
  private readonly fill: HTMLDivElement;
  private readonly knob: HTMLDivElement;
  private readonly label: HTMLDivElement;

  private video: HTMLVideoElement | null = null;
  private hovering = false;
  private dragging = false;
  private raf = 0;

  constructor() {
    this.root = document.createElement('div');
    this.root.setAttribute('data-saved-index', 'scrubber');
    Object.assign(this.root.style, {
      position: 'fixed',
      zIndex: '2147483001',
      height: '20px', // generous hit area; the bar itself stays 3px
      display: 'none',
      cursor: 'pointer',
      touchAction: 'none',
    } satisfies Partial<CSSStyleDeclaration>);

    this.track = document.createElement('div');
    Object.assign(this.track.style, {
      position: 'absolute',
      left: '0',
      right: '0',
      bottom: '0',
      height: '3px',
      background: 'rgba(255,255,255,0.24)',
      transition: 'height 120ms ease',
    } satisfies Partial<CSSStyleDeclaration>);

    this.fill = document.createElement('div');
    Object.assign(this.fill.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      bottom: '0',
      width: '0%',
      background: 'rgba(255,255,255,0.72)',
    } satisfies Partial<CSSStyleDeclaration>);

    this.knob = document.createElement('div');
    Object.assign(this.knob.style, {
      position: 'absolute',
      top: '50%',
      width: '9px',
      height: '9px',
      marginLeft: '-4.5px',
      marginTop: '-4.5px',
      borderRadius: '50%',
      background: '#fff',
      opacity: '0',
      transition: 'opacity 120ms ease',
      pointerEvents: 'none',
    } satisfies Partial<CSSStyleDeclaration>);

    this.label = document.createElement('div');
    Object.assign(this.label.style, {
      position: 'absolute',
      bottom: '14px',
      transform: 'translateX(-50%)',
      padding: '2px 6px',
      borderRadius: '4px',
      background: 'rgba(0,0,0,0.72)',
      color: '#fff',
      font: '10px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace',
      letterSpacing: '0.04em',
      whiteSpace: 'nowrap',
      opacity: '0',
      pointerEvents: 'none',
    } satisfies Partial<CSSStyleDeclaration>);

    this.track.append(this.fill, this.knob);
    this.root.append(this.track, this.label);
    document.body.appendChild(this.root);

    this.root.addEventListener('pointerenter', () => {
      this.hovering = true;
      this.paint();
    });
    this.root.addEventListener('pointerleave', () => {
      this.hovering = false;
      this.paint();
    });
    this.root.addEventListener('pointerdown', this.onDown);
  }

  bind(video: HTMLVideoElement): void {
    if (this.video === video) return;
    this.video = video;
    this.root.style.display = 'block';
    this.tick();
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.root.remove();
    this.video = null;
  }

  /** Follow the video's rect and playhead. Only runs while a video is bound. */
  private tick = (): void => {
    const video = this.video;
    if (!video || !video.isConnected) return this.unbind();

    const r = video.getBoundingClientRect();
    const offscreen = r.bottom < 0 || r.top > window.innerHeight || r.width === 0;
    const pointerAway =
      !this.dragging &&
      !this.hovering &&
      (pointerX < r.left || pointerX > r.right || pointerY < r.top - 40 || pointerY > r.bottom + 40);

    if (offscreen || pointerAway) return this.unbind();

    // Flush to the bottom edge, inside the video's rounded corners.
    this.root.style.left = `${r.left}px`;
    this.root.style.width = `${r.width}px`;
    this.root.style.top = `${r.bottom - 20}px`;

    this.paint();
    this.raf = requestAnimationFrame(this.tick);
  };

  private unbind(): void {
    cancelAnimationFrame(this.raf);
    this.video = null;
    this.root.style.display = 'none';
  }

  private paint(): void {
    const video = this.video;
    if (!video) return;

    const active = this.hovering || this.dragging;
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const pct = duration > 0 ? (video.currentTime / duration) * 100 : 0;

    this.track.style.height = active ? '7px' : '3px';
    this.fill.style.width = `${pct}%`;
    this.fill.style.background = this.dragging
      ? 'oklch(0.74 0.11 150)'
      : active
        ? '#fff'
        : 'rgba(255,255,255,0.72)';
    this.knob.style.left = `${pct}%`;
    this.knob.style.opacity = active ? '1' : '0';

    this.label.style.left = `${pct}%`;
    this.label.style.opacity = this.dragging ? '1' : '0';
    if (this.dragging) {
      this.label.textContent = `${fmt(video.currentTime)} / ${fmt(duration)}`;
    }
  }

  private onDown = (ev: PointerEvent): void => {
    if (!this.video) return;
    ev.preventDefault();
    ev.stopPropagation();
    this.dragging = true;
    this.seekTo(ev.clientX);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp, { once: true });
  };

  private onMove = (ev: PointerEvent): void => {
    if (this.dragging) this.seekTo(ev.clientX);
  };

  private onUp = (): void => {
    this.dragging = false;
    window.removeEventListener('pointermove', this.onMove);
    this.paint();
  };

  private seekTo(clientX: number): void {
    const video = this.video;
    if (!video || !Number.isFinite(video.duration)) return;
    const r = this.root.getBoundingClientRect();
    const t = clamp((clientX - r.left) / r.width, 0, 1);
    video.currentTime = t * video.duration;
    this.paint();
  }
}

function fmt(seconds: number): string {
  if (!Number.isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

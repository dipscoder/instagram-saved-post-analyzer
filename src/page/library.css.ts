/**
 * Styles for the library's Shadow DOM.
 *
 * Kept as a TS string so esbuild inlines it into the content-script bundle — a content
 * script has no stylesheet of its own to link, and injecting a <link> would be one more
 * thing for Instagram's CSP to refuse.
 *
 * Geist is the design's typeface but a content script can't pull a webfont past
 * Instagram's CSP, so this uses the system UI stack at the same sizes and weights.
 */

export const styles = /* css */ `
/*
 * One accent, a five-step type scale, and a 4px spacing grid. The hue is a desaturated
 * indigo: calm, unmistakably not Instagram's own chrome, and quiet enough that the
 * category chips are the only colour competing for attention.
 */
:host {
  --bg: #fff;
  --bg-sunk: oklch(0.976 0.004 265);
  --line: oklch(0.935 0.004 265);
  --line-strong: oklch(0.885 0.006 265);
  --text: oklch(0.25 0.012 265);
  --text-2: oklch(0.50 0.010 265);
  --text-3: oklch(0.645 0.008 265);
  --accent: oklch(0.52 0.095 265);
  --accent-wash: oklch(0.965 0.018 265);
  --accent-line: oklch(0.885 0.038 265);
  --danger: oklch(0.55 0.16 25);

  --sans: system-ui, -apple-system, "Segoe UI", sans-serif;
  --mono: ui-monospace, SFMono-Regular, Menlo, monospace;

  /* Type scale. Nothing outside these five. */
  --t-cap: 9.5px;   /* mono, uppercase, tracked */
  --t-sm: 11.5px;
  --t-md: 12.5px;
  --t-lg: 13px;
  --t-xl: 20px;
}

@media (prefers-color-scheme: dark) {
  :host {
    --bg: oklch(0.165 0.008 265);
    --bg-sunk: oklch(0.205 0.008 265);
    --line: oklch(0.255 0.008 265);
    --line-strong: oklch(0.315 0.010 265);
    --text: oklch(0.94 0.006 265);
    --text-2: oklch(0.71 0.010 265);
    --text-3: oklch(0.575 0.010 265);
    --accent: oklch(0.775 0.095 265);
    --accent-wash: oklch(0.255 0.030 265);
    --accent-line: oklch(0.375 0.050 265);
    --danger: oklch(0.72 0.13 25);
  }
}

* { box-sizing: border-box; }

/*
 * Keyboard focus has to be visible — the whole library is reachable by tab. Rendered as
 * a ring rather than a border swap so nothing shifts by a pixel when it appears.
 */
:where(button, input, select, a):focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: 6px;
}

.app {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg);
  color: var(--text);
  font-family: var(--sans);
  font-size: var(--t-lg);
  -webkit-font-smoothing: antialiased;
}

.mono { font-family: var(--mono); font-size: 10px; letter-spacing: 0.06em; }
.muted { color: var(--text-3); }

button { font: inherit; color: inherit; background: none; border: none; cursor: pointer; }

.link { color: var(--accent); font-size: var(--t-sm); padding: 0; text-align: left; }
.link:hover { text-decoration: underline; }

.ghost {
  padding: 6px 12px; border: 1px solid var(--line-strong);
  border-radius: 6px; font-size: var(--t-sm); color: var(--text-2);
  transition: border-color 120ms ease, color 120ms ease;
}
.ghost:hover { border-color: var(--accent); color: var(--accent); }

.primary {
  margin-top: 16px; padding: 8px 16px;
  border: 1px solid var(--accent); border-radius: 6px;
  font-size: var(--t-md); color: var(--accent);
  transition: background 120ms ease;
}
.primary:hover { background: var(--accent-wash); }

/* --- header --- */

.header {
  flex: none; display: flex; align-items: center; gap: 16px;
  padding: 14px 28px; border-bottom: 1px solid var(--line);
}
.brand { display: flex; align-items: center; gap: 8px; flex: none; }
.dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }
.brand-name { font-size: var(--t-lg); font-weight: 560; letter-spacing: -0.005em; }

.search {
  flex: 1; max-width: 440px;
  border: 1px solid var(--line-strong); border-radius: 7px;
  padding: 8px 12px; font-size: var(--t-md); font-family: inherit;
  background: var(--bg); color: var(--text); outline: none;
  transition: border-color 120ms ease;
}
.search:focus { border-color: var(--accent); }
.search::placeholder { color: var(--text-3); }

.header-right { margin-left: auto; display: flex; align-items: center; gap: 14px; }

.seg { display: flex; border: 1px solid var(--line-strong); border-radius: 6px; overflow: hidden; }
.seg-btn { padding: 5px 9px; font-size: var(--t-sm); color: var(--text-2); }
.seg-btn + .seg-btn { border-left: 1px solid var(--line); }
.seg-btn.on { background: var(--accent-wash); color: var(--accent); }
.seg-btn:hover:not(.on) { background: var(--bg-sunk); color: var(--text); }
/* The escape hatch. Reads as a place you can be, not a button that dismisses. */
.seg-where .seg-btn { padding: 6px 12px; }

/* --- layout --- */

.body { flex: 1; display: flex; overflow: hidden; }
.col { flex: 1; display: flex; flex-direction: column; overflow: hidden; }

.toolbar {
  flex: none; display: flex; align-items: center; gap: 12px;
  padding: 18px 28px 14px;
}

.rail {
  width: 216px; flex: none; display: flex; flex-direction: column; gap: 2px;
  padding: 22px 16px; border-right: 1px solid var(--line); overflow-y: auto;
}
.rail-row {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 7px 10px; border-radius: 6px; font-size: var(--t-md); width: 100%;
  color: var(--text-2); text-align: left;
  transition: background 100ms ease;
}
.rail-row:hover { background: var(--bg-sunk); }
.rail-row.on { background: var(--accent-wash); color: var(--accent); font-weight: 520; }
.count { color: var(--text-3); }
.divider { height: 1px; background: var(--line); margin: 12px 10px; }
.rail-label {
  font-family: var(--mono); font-size: var(--t-cap); letter-spacing: 0.12em;
  text-transform: uppercase; color: var(--text-3); padding: 0 10px 8px;
}
.rail-hint {
  font-size: var(--t-sm); line-height: 1.5; color: var(--text-3);
  padding: 8px 10px 2px;
}
.rail-foot { margin-top: auto; display: flex; flex-direction: column; gap: 8px; padding: 16px 10px 0; }

.main { flex: 1; display: flex; flex-direction: column; overflow-y: auto; }

.title { font-size: var(--t-xl); font-weight: 560; letter-spacing: -0.015em; margin: 0; }

.sort { margin-left: auto; display: flex; align-items: center; }
.sort select {
  appearance: none; font: inherit; font-size: var(--t-sm); color: var(--text-2);
  padding: 6px 26px 6px 11px; border: 1px solid var(--line-strong); border-radius: 6px;
  background: var(--bg) no-repeat right 8px center;
  background-image: linear-gradient(45deg, transparent 50%, currentColor 50%),
                    linear-gradient(135deg, currentColor 50%, transparent 50%);
  background-size: 4px 4px, 4px 4px;
  background-position: right 12px center, right 8px center;
  cursor: pointer; outline: none;
}
.sort select:hover, .sort select:focus { border-color: var(--accent); color: var(--accent); }

.chips { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; padding: 0 28px 10px; }
.chip {
  display: flex; align-items: center; gap: 6px; padding: 2.5px 7px;
  border: 1px solid var(--accent-line); background: var(--accent-wash);
  border-radius: 5px; font-size: var(--t-sm); color: var(--accent);
}
.chip .x { opacity: 0.7; }

/* --- stray notice --- */

.notice {
  flex: none; display: flex; align-items: flex-start; gap: 16px;
  margin: 16px 28px 0; padding: 13px 15px;
  border: 1px solid var(--accent-line); border-radius: 9px; background: var(--accent-wash);
}
.notice-body { flex: 1; display: flex; flex-direction: column; gap: 4px; }
.notice-title { font-size: var(--t-md); font-weight: 560; }
.notice p { margin: 0; font-size: var(--t-sm); line-height: 1.55; color: var(--text-2); max-width: 62ch; }
.notice-actions { flex: none; display: flex; align-items: center; gap: 12px; }

/* --- indexing panel --- */

.panel {
  flex: none; display: flex; flex-direction: column; gap: 10px; align-items: flex-start;
  margin: 16px 28px 0; padding: 13px 15px;
  background: var(--bg-sunk); border: 1px solid var(--line); border-radius: 9px;
}
.panel-top { display: flex; align-items: center; gap: 12px; width: 100%; }
.panel-title { font-size: var(--t-md); font-weight: 520; flex: 1; }
.panel-actions { display: flex; align-items: center; gap: 6px; flex: none; }

.pill {
  padding: 5px 14px; border-radius: 999px; font-size: var(--t-sm); font-weight: 500;
  border: 1px solid var(--accent); color: var(--accent);
  transition: background 120ms ease;
}
.pill:hover { background: var(--accent-wash); }

.track { width: 100%; height: 2px; background: var(--line-strong); border-radius: 1px; overflow: hidden; }
.track-fill { height: 100%; background: var(--accent); transition: width 240ms ease; }
.panel.paused .track-fill, .panel.error .track-fill { background: var(--text-3); }

.facts { display: flex; flex-wrap: wrap; gap: 22px; }
.fact { display: flex; flex-direction: column; gap: 3px; }
.fact-value { font-size: 15px; letter-spacing: 0; color: var(--text); }
.cap {
  font-family: var(--mono); font-size: var(--t-cap); letter-spacing: 0.11em;
  text-transform: uppercase; color: var(--text-3);
}

.panel-note { font-size: var(--t-sm); line-height: 1.5; color: var(--text-2); }
.panel-note.bad { color: var(--danger); }

.explain { display: flex; flex-direction: column; gap: 12px; padding-top: 2px; }
.explain-row { display: flex; flex-direction: column; gap: 4px; max-width: 62ch; }
.explain-title { font-size: var(--t-sm); font-weight: 560; }
.explain p { margin: 0; font-size: var(--t-sm); line-height: 1.6; color: var(--text-2); }

.x-btn { width: 18px; height: 18px; border-radius: 4px; color: var(--text-3); font-size: 13px; }
.x-btn:hover { background: var(--line); }

/* --- results --- */

.grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(196px, 1fr));
  gap: 8px; padding: 4px 20px 32px;
}
/* Cards carry 8px of their own padding, so the container stops 8 short of the 28px
   gutter the header and toolbar use. Content lines up; hover backgrounds still bleed. */
.list { display: flex; flex-direction: column; padding: 4px 20px 32px; }

.card {
  display: flex; flex-direction: column; gap: 10px;
  padding: 8px; border-radius: 10px;
  color: inherit; text-decoration: none;
  transition: background 120ms ease;
}
.card:hover { background: var(--bg-sunk); }

.list .card {
  flex-direction: row; align-items: center; gap: 14px;
  padding: 11px 8px; border-bottom: 1px solid var(--line); border-radius: 0;
}

.thumb {
  aspect-ratio: 1 / 1; border-radius: 7px; overflow: hidden;
  background: var(--bg-sunk); position: relative; display: flex;
}
.list .thumb { width: 44px; height: 44px; aspect-ratio: auto; flex: none; border-radius: 6px; }
.thumb img { width: 100%; height: 100%; object-fit: cover; }
.kind, .dur {
  position: absolute; bottom: 6px; color: #fff; opacity: 0.9;
  text-shadow: 0 1px 3px rgba(0,0,0,0.6);
}
.kind { left: 8px; }
.dur { right: 8px; }
.list .kind, .list .dur { display: none; }

/* Fixed height so a card never jumps when its summary lands. */
.summary {
  font-size: var(--t-md); line-height: 1.4; height: 35px; overflow: hidden;
  color: var(--text);
}
.list .summary { flex: 1; height: auto; }
.queued { color: var(--text-3); }

.meta { display: flex; align-items: center; gap: 8px; min-width: 0; }
.list .meta { flex: none; }
.handle {
  color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.date { margin-left: auto; color: var(--text-3); flex: none; cursor: help; }
.added { color: var(--text-3); flex: none; }
.list .date { margin-left: 16px; }

.cat {
  flex: none; padding: 2px 7px; border-radius: 5px; font-size: 10.5px; line-height: 1.45;
  font-weight: 500; white-space: nowrap;
  background: oklch(0.955 0.032 var(--hue));
  border: 1px solid oklch(0.895 0.045 var(--hue));
  color: oklch(0.44 0.075 var(--hue));
}
@media (prefers-color-scheme: dark) {
  .cat {
    background: oklch(0.27 0.035 var(--hue));
    border-color: oklch(0.37 0.045 var(--hue));
    color: oklch(0.855 0.055 var(--hue));
  }
}
.cat-none {
  background: transparent; border: 1px dashed var(--line-strong); color: var(--text-3);
  font-weight: 450;
}

.more {
  display: flex; align-items: center; justify-content: center; gap: 12px;
  padding: 4px 28px 36px;
}

/* --- empty / error --- */

.empty {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 10px; padding: 80px 40px; text-align: center;
}
.empty-mark {
  width: 26px; height: 26px; margin-bottom: 8px; border-radius: 7px;
  border: 1px solid var(--line-strong); background: var(--bg-sunk);
}
.empty-title { font-size: var(--t-lg); font-weight: 560; }
.empty-detail { font-size: var(--t-md); line-height: 1.6; color: var(--text-2); max-width: 340px; }

/* --- the way back in --- */

/*
 * Only node still alive when the library is hidden. The host keeps its box so this and
 * the keyboard shortcut still work, but stops taking pointer events — so this has to
 * take them back, or it would not be clickable.
 */
.restore {
  position: absolute; right: 20px; bottom: 20px; pointer-events: auto;
  display: flex; align-items: center; gap: 9px;
  padding: 9px 14px; border-radius: 999px;
  border: 1px solid var(--line-strong); background: var(--bg); color: var(--text);
  font-family: var(--sans); font-size: 12px; font-weight: 500;
  box-shadow: 0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.10);
}
.restore:hover { border-color: var(--accent); color: var(--accent); }
.restore-key { color: var(--text-3); letter-spacing: 0.04em; }

@media (max-width: 900px) {
  .rail { display: none; }
  .header { padding: 12px 16px; flex-wrap: wrap; }
  .grid, .list { padding: 6px 16px 24px; }
  .toolbar { padding: 14px 16px 12px; }
  .chips { padding: 0 16px 10px; }
  .notice, .panel { margin: 12px 16px 0; }
}
`;

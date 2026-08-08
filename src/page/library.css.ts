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
:host {
  --bg: #fff;
  --bg-sunk: oklch(0.975 0.006 150);
  --line: oklch(0.94 0.004 150);
  --line-strong: oklch(0.90 0.004 150);
  --text: oklch(0.24 0.005 150);
  --text-2: oklch(0.50 0.005 150);
  --text-3: oklch(0.64 0.005 150);
  --accent: oklch(0.50 0.10 150);
  --accent-wash: oklch(0.97 0.015 150);
  --accent-line: oklch(0.89 0.03 150);
  --sans: system-ui, -apple-system, "Segoe UI", sans-serif;
  --mono: ui-monospace, SFMono-Regular, Menlo, monospace;
}

@media (prefers-color-scheme: dark) {
  :host {
    --bg: oklch(0.15 0.004 150);
    --bg-sunk: oklch(0.19 0.004 150);
    --line: oklch(0.24 0.004 150);
    --line-strong: oklch(0.28 0.004 150);
    --text: oklch(0.93 0.004 150);
    --text-2: oklch(0.68 0.005 150);
    --text-3: oklch(0.56 0.005 150);
    --accent: oklch(0.74 0.11 150);
    --accent-wash: oklch(0.24 0.02 150);
    --accent-line: oklch(0.36 0.04 150);
  }
}

* { box-sizing: border-box; }

.app {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg);
  color: var(--text);
  font-family: var(--sans);
  font-size: 13px;
  -webkit-font-smoothing: antialiased;
}

.mono { font-family: var(--mono); font-size: 10px; letter-spacing: 0.06em; }
.muted { color: var(--text-3); }

button { font: inherit; color: inherit; background: none; border: none; cursor: pointer; }

.link { color: var(--accent); font-size: 11px; padding: 0; text-align: left; }
.link:hover { text-decoration: underline; }

.ghost {
  padding: 5px 10px; border: 1px solid var(--line-strong);
  border-radius: 6px; font-size: 11.5px; color: var(--text-2);
}
.ghost:hover { border-color: var(--accent); color: var(--accent); }

.primary {
  margin-top: 14px; padding: 7px 14px;
  border: 1px solid var(--accent); border-radius: 6px;
  font-size: 12px; color: var(--accent);
}
.primary:hover { background: var(--accent-wash); }

/* --- header --- */

.header {
  flex: none; display: flex; align-items: center; gap: 16px;
  padding: 14px 28px; border-bottom: 1px solid var(--line);
}
.brand { display: flex; align-items: center; gap: 8px; flex: none; }
.dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }
.brand-name { font-size: 13px; font-weight: 560; letter-spacing: -0.005em; }

.search {
  flex: 1; max-width: 440px;
  border: 1px solid var(--line-strong); border-radius: 7px;
  padding: 8px 12px; font-size: 12.5px; font-family: inherit;
  background: var(--bg); color: var(--text); outline: none;
}
.search:focus { border-color: var(--accent); }
.search::placeholder { color: var(--text-3); }

.header-right { margin-left: auto; display: flex; align-items: center; gap: 14px; }

.seg { display: flex; border: 1px solid var(--line-strong); border-radius: 6px; overflow: hidden; }
.seg-btn { padding: 5px 9px; font-size: 11px; color: var(--text-2); }
.seg-btn + .seg-btn { border-left: 1px solid var(--line); }
.seg-btn.on { background: var(--accent-wash); color: var(--accent); }

/* --- layout --- */

.body { flex: 1; display: flex; overflow: hidden; }

.rail {
  width: 216px; flex: none; display: flex; flex-direction: column; gap: 2px;
  padding: 22px 16px; border-right: 1px solid var(--line); overflow-y: auto;
}
.rail-row {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 6px 10px; border-radius: 6px; font-size: 12.5px; width: 100%;
  color: var(--text-2); text-align: left;
}
.rail-row:hover { background: var(--bg-sunk); }
.rail-row.on { background: var(--accent-wash); color: var(--accent); font-weight: 520; }
.count { color: var(--text-3); }
.divider { height: 1px; background: var(--line); margin: 12px 10px; }
.rail-label {
  font-family: var(--mono); font-size: 9px; letter-spacing: 0.12em;
  text-transform: uppercase; color: var(--text-3); padding: 0 10px 8px;
}
.rail-hint {
  font-size: 10.5px; line-height: 1.5; color: var(--text-3);
  padding: 8px 10px 2px;
}
.rail-foot { margin-top: auto; display: flex; flex-direction: column; gap: 8px; padding: 16px 10px 0; }

.main { flex: 1; display: flex; flex-direction: column; overflow-y: auto; }

.main-head {
  flex: none; display: flex; align-items: center; gap: 12px;
  padding: 20px 28px 14px; flex-wrap: wrap;
}
.title { font-size: 20px; font-weight: 560; letter-spacing: -0.01em; margin: 0; }

.chips { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.chip {
  display: flex; align-items: center; gap: 6px; padding: 2.5px 7px;
  border: 1px solid var(--accent-line); background: var(--accent-wash);
  border-radius: 5px; font-size: 11.5px; color: var(--accent);
}
.chip .x { opacity: 0.7; }

/* --- indexing panel --- */

.panel {
  flex: none; display: flex; flex-direction: column; gap: 10px; align-items: flex-start;
  margin: 16px 28px 0; padding: 13px 15px;
  background: var(--bg-sunk); border: 1px solid var(--line); border-radius: 9px;
}
.panel-top { display: flex; align-items: center; gap: 12px; width: 100%; }
.panel-title { font-size: 12.5px; font-weight: 520; flex: 1; }
.panel-actions { display: flex; align-items: center; gap: 6px; flex: none; }

.pill {
  padding: 4px 12px; border-radius: 999px; font-size: 11.5px; font-weight: 500;
  border: 1px solid var(--accent); color: var(--accent);
}
.pill:hover { background: var(--accent-wash); }

.track { width: 100%; height: 2px; background: var(--line-strong); border-radius: 1px; overflow: hidden; }
.track-fill { height: 100%; background: var(--accent); transition: width 240ms ease; }
.panel.paused .track-fill, .panel.error .track-fill { background: var(--text-3); }

.facts { display: flex; flex-wrap: wrap; gap: 22px; }
.fact { display: flex; flex-direction: column; gap: 3px; }
.fact-value { font-size: 14px; letter-spacing: 0; color: var(--text); }
.cap {
  font-family: var(--mono); font-size: 9px; letter-spacing: 0.11em;
  text-transform: uppercase; color: var(--text-3);
}

.panel-note { font-size: 11.5px; line-height: 1.5; color: var(--text-2); }
.panel-note.bad { color: oklch(0.55 0.16 25); }

.explain { display: flex; flex-direction: column; gap: 12px; padding-top: 2px; }
.explain-row { display: flex; flex-direction: column; gap: 4px; max-width: 62ch; }
.explain-title { font-size: 11.5px; font-weight: 560; }
.explain p { margin: 0; font-size: 11.5px; line-height: 1.6; color: var(--text-2); }

.x-btn { width: 18px; height: 18px; border-radius: 4px; color: var(--text-3); font-size: 13px; }
.x-btn:hover { background: var(--line); }

/* --- results --- */

.grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 24px; padding: 6px 28px 28px;
}
.list { display: flex; flex-direction: column; padding: 6px 28px 28px; }

.card {
  display: flex; flex-direction: column; gap: 10px;
  padding: 8px; margin: -8px; border-radius: 8px;
  color: inherit; text-decoration: none;
}
.card:hover { background: var(--bg-sunk); }

.list .card {
  flex-direction: row; align-items: center; gap: 14px;
  margin: 0; padding: 11px 8px; border-bottom: 1px solid var(--line); border-radius: 0;
}

.thumb {
  aspect-ratio: 1 / 1; border-radius: 6px; overflow: hidden;
  background: var(--line); position: relative; display: flex;
}
.list .thumb { width: 44px; height: 44px; aspect-ratio: auto; flex: none; }
.thumb img { width: 100%; height: 100%; object-fit: cover; }
.kind, .dur {
  position: absolute; bottom: 6px; color: #fff; opacity: 0.9;
  text-shadow: 0 1px 3px rgba(0,0,0,0.6);
}
.kind { left: 8px; }
.dur { right: 8px; }
.list .kind, .list .dur { display: none; }

.summary {
  font-size: 12.5px; line-height: 1.35; height: 34px; overflow: hidden;
  color: var(--text);
}
.list .summary { flex: 1; height: auto; }
.queued { color: var(--text-3); }

.meta { display: flex; align-items: center; gap: 8px; min-width: 0; }
.list .meta { flex: none; }
.handle {
  color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.date { margin-left: auto; color: var(--text-3); flex: none; }

.cat {
  flex: none; padding: 1.5px 6px; border-radius: 4px; font-size: 10.5px; line-height: 1.5;
  font-weight: 500; white-space: nowrap;
  background: oklch(0.96 0.03 var(--hue));
  border: 1px solid oklch(0.88 0.05 var(--hue));
  color: oklch(0.40 0.07 var(--hue));
}
@media (prefers-color-scheme: dark) {
  .cat {
    background: oklch(0.26 0.03 var(--hue));
    border-color: oklch(0.36 0.04 var(--hue));
    color: oklch(0.86 0.05 var(--hue));
  }
}
.cat-none {
  background: transparent; border: 1px dashed var(--line-strong); color: var(--text-3);
  font-weight: 450;
}

/* --- empty / error --- */

.empty {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 10px; padding: 100px 40px; text-align: center;
}
.empty-mark { width: 22px; height: 22px; border: 1px solid var(--line-strong); border-radius: 3px; margin-bottom: 6px; }
.empty-title { font-size: 13px; font-weight: 520; }
.empty-detail { font-size: 12px; line-height: 1.55; color: var(--text-2); max-width: 320px; }

@media (max-width: 900px) {
  .rail { display: none; }
  .header { padding: 12px 16px; }
  .grid, .list { padding: 6px 16px 24px; }
  .main-head { padding: 16px 16px 12px; }
  .panel { margin: 12px 16px 0; }
}
`;

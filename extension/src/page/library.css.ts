/** A self-contained visual system for the Shadow DOM library. */
export const styles = /* css */ `
:host {
  --canvas: #f5f6fa;
  --surface: #ffffff;
  --surface-2: #f0f2f7;
  --surface-3: #e9ecf3;
  --line: #e3e6ee;
  --line-strong: #cbd0dc;
  --text: #171923;
  --text-2: #5f6472;
  --text-3: #858b99;
  --accent: #6e44f5;
  --accent-strong: #5a31e0;
  --on-accent: #ffffff;
  --accent-wash: #f1ecff;
  --accent-line: #ddd2ff;
  --danger: #c9425a;
  --on-danger: #ffffff;
  --shadow-sm: 0 1px 2px rgba(20, 23, 35, 0.04), 0 5px 16px rgba(20, 23, 35, 0.04);
  --shadow-lg: 0 18px 50px rgba(20, 23, 35, 0.13);
  --sans: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --mono: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  --t-cap: 10px;
  --t-sm: 12px;
  --t-md: 14px;
  --t-lg: 16px;
  --t-xl: 24px;
}

@media (prefers-color-scheme: dark) {
  :host {
    --canvas: #0b0d12;
    --surface: #12151c;
    --surface-2: #191d27;
    --surface-3: #202531;
    --line: #252a35;
    --line-strong: #353b49;
    --text: #f3f4f8;
    --text-2: #a7adbb;
    --text-3: #737a8a;
    --accent: #a48bff;
    --accent-strong: #bba8ff;
    --on-accent: #11131a;
    --accent-wash: #261f3d;
    --accent-line: #3f3466;
    --danger: #ff8095;
    --on-danger: #171017;
    --shadow-sm: 0 1px 1px rgba(0, 0, 0, 0.22), 0 10px 30px rgba(0, 0, 0, 0.12);
    --shadow-lg: 0 24px 70px rgba(0, 0, 0, 0.42);
  }
}

* { box-sizing: border-box; }
[hidden] { display: none !important; }
:where(button, input, select, a):focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; }
.mono { font-family: var(--mono); font-size: var(--t-cap); letter-spacing: 0.055em; }
.muted { color: var(--text-3); }

.app {
  display: flex; flex-direction: column; height: 100%; overflow: hidden;
  background: var(--canvas); color: var(--text);
  font: 400 var(--t-md)/1.5 var(--sans); -webkit-font-smoothing: antialiased;
}
.link {
  min-height: 30px; padding: 5px 0; color: var(--accent);
  font-size: var(--t-sm); font-weight: 550; text-align: left;
}
.link:hover { color: var(--accent-strong); }
.ghost, .pill, .primary {
  display: inline-flex; min-height: 36px; align-items: center; justify-content: center;
  border-radius: 10px; padding: 7px 14px; font-size: var(--t-sm); font-weight: 650;
  text-decoration: none;
  transition: transform 140ms ease, border-color 140ms ease, background 140ms ease, color 140ms ease;
}
.ghost { border: 1px solid var(--line-strong); background: var(--surface); color: var(--text-2); }
.ghost:hover { border-color: var(--accent); color: var(--accent); }
.pill, .primary {
  border: 1px solid var(--accent); background: var(--accent); color: var(--on-accent);
  box-shadow: 0 6px 18px color-mix(in srgb, var(--accent) 20%, transparent);
}
.pill:hover, .primary:hover { background: var(--accent-strong); transform: translateY(-1px); }
.pill.danger { border-color: var(--danger); background: var(--danger); color: var(--on-danger); }
.primary { margin-top: 12px; }

/* Header */
.header {
  flex: none; min-height: 68px; display: flex; align-items: center; gap: 24px;
  padding: 12px 28px; border-bottom: 1px solid var(--line);
  background: color-mix(in srgb, var(--surface) 94%, transparent); backdrop-filter: blur(18px);
}
.brand { flex: none; display: flex; align-items: center; gap: 10px; }
.brand-mark {
  position: relative; width: 30px; height: 30px; border-radius: 9px;
  background: linear-gradient(120deg, #ff6a55, #f03e86 50%, #7a4cff);
  box-shadow: 0 6px 16px rgba(240, 62, 134, 0.24);
}
.brand-mark::before {
  content: ""; position: absolute; left: 9px; top: 7px; width: 12px; height: 16px;
  border-radius: 3px 3px 2px 2px; background: #fff;
  clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 72%, 0 100%);
}
.brand-mark::after {
  content: ""; position: absolute; z-index: 1; left: 12px; top: 10px; width: 6px; height: 6px;
  background: #f03e86;
  clip-path: polygon(50% 0, 62% 38%, 100% 50%, 62% 62%, 50% 100%, 38% 62%, 0 50%, 38% 38%);
}
.brand-name { font-size: 15px; font-weight: 700; letter-spacing: -0.02em; }
.search {
  width: min(42vw, 560px); height: 40px; border: 1px solid var(--line); border-radius: 12px;
  padding: 0 15px; background: var(--surface-2); color: var(--text);
  font: 450 var(--t-md) var(--sans);
  transition: border-color 140ms ease, background 140ms ease, box-shadow 140ms ease;
}
.search::placeholder { color: var(--text-3); }
.search:hover { border-color: var(--line-strong); }
.search:focus { border-color: var(--accent); background: var(--surface); box-shadow: 0 0 0 3px var(--accent-wash); }
.search:focus:not(:focus-visible) { outline: none; }
.header-right { margin-left: auto; display: flex; align-items: center; gap: 14px; }
.header-right > .muted { padding: 6px 9px; border-radius: 8px; background: var(--surface-2); color: var(--text-2); }
.seg {
  display: inline-flex; align-items: center; gap: 3px; padding: 3px;
  border: 1px solid var(--line); border-radius: 10px; background: var(--surface-2);
}
.seg-btn {
  min-height: 28px; padding: 5px 10px; border-radius: 7px;
  color: var(--text-2); font-size: var(--t-sm); font-weight: 550;
}
.seg-btn:hover { color: var(--text); }
.seg-btn.on { background: var(--surface); color: var(--text); box-shadow: var(--shadow-sm); }
.seg-where .seg-btn { min-height: 32px; padding-inline: 13px; }

/* Main layout */
.body { min-height: 0; flex: 1; display: flex; overflow: hidden; }
.col { min-width: 0; flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.rail, .main { overscroll-behavior: contain; }
.rail {
  width: 236px; flex: none; display: flex; flex-direction: column; gap: 3px;
  overflow-y: auto; padding: 26px 18px 20px; border-right: 1px solid var(--line);
  background: var(--surface);
}
.rail-row {
  width: 100%; min-height: 38px; display: flex; align-items: center;
  justify-content: space-between; gap: 10px; padding: 8px 11px; border-radius: 10px;
  color: var(--text-2); font-size: 13px; font-weight: 500; text-align: left;
  transition: background 120ms ease, color 120ms ease;
}
.rail-row:hover { background: var(--surface-2); color: var(--text); }
.rail-row.on { background: var(--accent-wash); color: var(--accent); font-weight: 650; }
.rail-row .count {
  min-width: 24px; padding: 2px 5px; border-radius: 6px;
  background: var(--surface-2); color: var(--text-3); text-align: center;
}
.rail-row.on .count { background: color-mix(in srgb, var(--accent) 11%, transparent); color: var(--accent); }
.divider { height: 1px; margin: 13px 10px; background: var(--line); }
.rail-label {
  padding: 2px 11px 8px; color: var(--text-3); font: 650 var(--t-cap) var(--sans);
  letter-spacing: 0.12em; text-transform: uppercase;
}
.rail-hint { padding: 7px 11px 2px; color: var(--text-3); font-size: 11px; line-height: 1.5; }
.rail-foot { margin-top: auto; display: flex; flex-direction: column; gap: 6px; padding: 18px 11px 0; }
.main { flex: 1; overflow-y: auto; }
.toolbar { flex: none; display: flex; align-items: center; gap: 12px; padding: 28px 32px 17px; }
.back {
  min-height: 34px; margin-left: -8px; padding: 6px 9px; border-radius: 9px;
  color: var(--text-2); font-size: var(--t-sm); font-weight: 600;
}
.back:hover { background: var(--surface-2); color: var(--text); }
.title { margin: 0; font-size: var(--t-xl); font-weight: 720; letter-spacing: -0.035em; }
.toolbar > .muted { color: var(--text-3); }
.sort { margin-left: auto; display: flex; align-items: center; }
.sort select {
  min-height: 34px; appearance: none; border: 1px solid var(--line); border-radius: 9px;
  padding: 6px 30px 6px 11px; background: var(--surface) no-repeat right 10px center;
  background-image: linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%);
  background-size: 4px 4px, 4px 4px; background-position: right 14px center, right 10px center;
  color: var(--text-2); font: 550 var(--t-sm) var(--sans); cursor: pointer;
}
.sort select:hover, .sort select:focus { border-color: var(--accent); color: var(--text); }
.sort select:focus:not(:focus-visible) { outline: none; }
.chips { display: flex; flex-wrap: wrap; gap: 7px; padding: 0 32px 10px; }
.chip {
  display: inline-flex; align-items: center; gap: 7px; min-height: 28px; padding: 4px 9px;
  border: 1px solid var(--accent-line); border-radius: 999px;
  background: var(--accent-wash); color: var(--accent); font-size: var(--t-sm); font-weight: 600;
}
.chip .x { opacity: 0.66; }

/* Notices and run status */
.notice, .panel {
  width: calc(100% - 64px); max-width: 1240px; margin: 10px 32px 14px;
  border: 1px solid var(--line); border-radius: 14px; background: var(--surface); box-shadow: var(--shadow-sm);
}
.notice { display: flex; align-items: center; gap: 18px; padding: 15px 17px; }
.notice-body { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 3px; }
.notice-title { font-size: 13px; font-weight: 680; }
.notice p { max-width: 68ch; margin: 0; color: var(--text-2); font-size: var(--t-sm); line-height: 1.5; }
.notice-actions { flex: none; display: flex; align-items: center; gap: 12px; }
.panel { display: flex; flex-direction: column; gap: 12px; padding: 15px 17px; }
.panel-top { width: 100%; display: flex; align-items: center; gap: 12px; }
.panel-title { flex: 1; font-size: 13px; font-weight: 680; }
.panel-actions { flex: none; display: flex; align-items: center; gap: 7px; }
.panel .pill { min-height: 32px; padding: 5px 13px; }
.track { width: 100%; height: 4px; overflow: hidden; border-radius: 99px; background: var(--surface-3); }
.track-fill { height: 100%; border-radius: inherit; background: linear-gradient(90deg, #7569fc, #5d7af5); transition: width 240ms ease; }
.panel.paused .track-fill, .panel.error .track-fill { background: var(--text-3); }
.facts { display: flex; flex-wrap: wrap; gap: 14px 28px; }
.fact { display: flex; align-items: baseline; gap: 6px; }
.fact-value { color: var(--text); font-size: 13px; font-weight: 650; letter-spacing: 0; }
.cap { color: var(--text-3); font: 600 var(--t-cap) var(--sans); letter-spacing: 0.08em; text-transform: uppercase; }
.panel-note { color: var(--text-2); font-size: var(--t-sm); line-height: 1.5; }
.panel-note.bad { color: var(--danger); }
.explain { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; padding-top: 3px; }
.explain-row { display: flex; flex-direction: column; gap: 4px; padding: 12px; border-radius: 10px; background: var(--surface-2); }
.explain-title { font-size: var(--t-sm); font-weight: 680; }
.explain p { margin: 0; color: var(--text-2); font-size: 11px; line-height: 1.55; }
.x-btn { width: 30px; height: 30px; border-radius: 8px; color: var(--text-3); font-size: 16px; }
.x-btn:hover { background: var(--surface-2); color: var(--text); }

/* Results */
.grid {
  width: 100%; max-width: 1800px; display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 20px; padding: 8px 32px 48px;
}
.list { width: 100%; max-width: 1260px; display: flex; flex-direction: column; padding: 6px 32px 48px; }
.card {
  min-width: 0; overflow: hidden; display: flex; flex-direction: column; gap: 0;
  border: 1px solid var(--line); border-radius: 16px; background: var(--surface);
  color: inherit; text-decoration: none; box-shadow: var(--shadow-sm);
  transition: transform 160ms ease, border-color 160ms ease, box-shadow 160ms ease;
}
.card:hover { transform: translateY(-2px); border-color: var(--line-strong); box-shadow: var(--shadow-lg); }
.thumb {
  position: relative; aspect-ratio: 1 / 1; overflow: hidden; display: flex;
  align-items: center; justify-content: center; background: var(--surface-2); border-bottom: 1px solid var(--line);
}
.thumb img, .detail-media img {
  position: absolute; inset: 0; z-index: 1; width: 100%; height: 100%; object-fit: cover;
  opacity: 0; transition: opacity 180ms ease, transform 260ms ease;
}
.media-ready img { opacity: 1; }
.card:hover .media-ready img { transform: scale(1.018); }
.media-fallback {
  position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 11px;
  background: radial-gradient(circle at 20% 12%, color-mix(in srgb, var(--accent) 14%, transparent), transparent 36%), linear-gradient(145deg, var(--surface-2), var(--surface-3));
  color: var(--text-3);
}
.media-fallback-mark {
  width: 24px; height: 31px; border: 1.5px solid currentColor; border-radius: 6px 6px 4px 4px;
  opacity: 0.72; clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 76%, 0 100%);
}
.media-fallback-label { font-size: 11px; font-weight: 600; letter-spacing: 0.01em; }
.kind, .dur {
  position: absolute; z-index: 2; bottom: 10px; min-height: 24px; display: inline-flex;
  align-items: center; padding: 4px 7px; border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 7px; background: rgba(9, 11, 16, 0.62); color: #fff;
  letter-spacing: 0.07em; backdrop-filter: blur(8px);
}
.kind { left: 10px; }
.dur { right: 10px; }
.summary {
  min-height: 60px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2;
  -webkit-box-orient: vertical; padding: 14px 14px 7px; color: var(--text);
  font-size: 14px; font-weight: 560; line-height: 1.45; letter-spacing: -0.008em;
}
.queued { color: var(--text-3); font-weight: 500; }
.meta { min-width: 0; display: flex; align-items: center; gap: 8px; padding: 0 14px 14px; }
.handle { min-width: 0; overflow: hidden; color: var(--text-3); text-overflow: ellipsis; white-space: nowrap; }
.date { flex: none; margin-left: auto; color: var(--text-3); cursor: help; }
.added { flex: none; color: var(--text-3); }
.cat {
  min-width: 0; max-width: 50%; flex: 0 1 auto; overflow: hidden; padding: 3px 7px;
  border: 1px solid oklch(0.86 0.055 var(--hue)); border-radius: 7px;
  background: oklch(0.95 0.038 var(--hue)); color: oklch(0.40 0.10 var(--hue));
  font-size: var(--t-cap); font-weight: 680; line-height: 1.4; text-overflow: ellipsis; white-space: nowrap;
}
.cat-none { border-style: dashed; border-color: var(--line-strong); background: transparent; color: var(--text-3); }
@media (prefers-color-scheme: dark) {
  .cat { border-color: oklch(0.39 0.045 var(--hue)); background: oklch(0.27 0.035 var(--hue)); color: oklch(0.86 0.06 var(--hue)); }
}
.list .card {
  min-height: 82px; flex-direction: row; align-items: center; gap: 16px; overflow: visible;
  padding: 10px 8px; border: 0; border-bottom: 1px solid var(--line);
  border-radius: 0; background: transparent; box-shadow: none;
}
.list .card:hover { transform: none; background: var(--surface-2); }
.list .thumb { width: 62px; height: 62px; flex: none; border: 0; border-radius: 11px; }
.list .media-fallback-label, .list .kind, .list .dur { display: none; }
.list .summary { min-height: 0; flex: 1; padding: 0; }
.list .meta { flex: 0 1 46%; padding: 0 10px 0 0; }
.list .date { margin-left: 14px; }
.more { display: flex; align-items: center; justify-content: center; gap: 12px; padding: 4px 32px 42px; }

/* Post detail */
.detail {
  width: min(1040px, calc(100% - 64px)); display: grid;
  grid-template-columns: minmax(300px, 48%) minmax(300px, 1fr); align-items: start;
  gap: 38px; margin: 12px 32px 56px; padding: 22px;
  border: 1px solid var(--line); border-radius: 20px; background: var(--surface); box-shadow: var(--shadow-sm);
}
.detail-media {
  position: relative; aspect-ratio: 1 / 1; overflow: hidden; display: flex;
  align-items: center; justify-content: center; border-radius: 15px; background: var(--surface-2);
}
.detail-info { min-width: 0; display: flex; flex-direction: column; gap: 18px; padding: 6px 8px 6px 0; }
.detail-heading { display: flex; align-items: center; gap: 10px; }
.detail-summary { margin: 0; font-size: 25px; font-weight: 680; line-height: 1.28; letter-spacing: -0.03em; }
.detail-facts {
  display: grid; grid-template-columns: 104px minmax(0, 1fr); gap: 9px 16px;
  margin: 0; padding: 16px 0; border-block: 1px solid var(--line); font-size: var(--t-sm); line-height: 1.5;
}
.detail-facts dt { color: var(--text-3); }
.detail-facts dd { margin: 0; overflow-wrap: anywhere; color: var(--text-2); }
.detail-label { color: var(--text-3); font-size: var(--t-cap); font-weight: 680; letter-spacing: 0.12em; text-transform: uppercase; }
.detail-caption { max-height: 220px; overflow: auto; margin: -9px 0 0; color: var(--text-2); font-size: 13px; line-height: 1.7; white-space: pre-wrap; }
.detail-status { padding: 11px 13px; border-radius: 10px; background: var(--accent-wash); color: var(--text-2); font-size: var(--t-sm); line-height: 1.5; }
.detail-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }

/* Empty and restore states */
.empty { min-height: 420px; display: flex; flex: 1; flex-direction: column; align-items: center; justify-content: center; gap: 9px; padding: 70px 36px; text-align: center; }
.empty-mark {
  position: relative; width: 42px; height: 42px; margin-bottom: 9px; border-radius: 13px;
  background: linear-gradient(120deg, #ff6a55, #f03e86 50%, #7a4cff); box-shadow: 0 10px 25px rgba(240, 62, 134, 0.24);
}
.empty-mark::before {
  content: ""; position: absolute; left: 13px; top: 10px; width: 16px; height: 21px;
  border-radius: 4px; background: #fff; clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 73%, 0 100%);
}
.empty-mark::after {
  content: ""; position: absolute; z-index: 1; left: 17px; top: 14px; width: 8px; height: 8px;
  background: #f03e86;
  clip-path: polygon(50% 0, 62% 38%, 100% 50%, 62% 62%, 50% 100%, 38% 62%, 0 50%, 38% 38%);
}
.empty-title { font-size: var(--t-lg); font-weight: 680; }
.empty-detail { max-width: 390px; color: var(--text-2); font-size: 13px; line-height: 1.6; }
.restore {
  position: absolute; right: 22px; bottom: 22px; pointer-events: auto;
  display: flex; align-items: center; gap: 9px; min-height: 42px; padding: 8px 14px 8px 9px;
  border: 1px solid var(--line); border-radius: 14px; background: var(--surface); color: var(--text);
  font: 650 var(--t-sm) var(--sans); box-shadow: var(--shadow-lg);
}
.restore:hover { border-color: var(--accent); transform: translateY(-1px); }
.restore .brand-mark { width: 26px; height: 26px; border-radius: 8px; }
.restore .brand-mark::before { left: 8px; top: 6px; width: 10px; height: 14px; }
.restore .brand-mark::after { left: 10.5px; top: 9px; width: 5px; height: 5px; }
.restore-key { color: var(--text-3); }

@media (max-width: 1900px) { .grid { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
@media (max-width: 1500px) {
  .grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .explain { grid-template-columns: 1fr; }
}
@media (max-width: 1050px) {
  .rail { display: none; }
  .header { padding-inline: 18px; gap: 14px; }
  .search { width: auto; min-width: 180px; flex: 1; }
  .toolbar { padding: 22px 20px 15px; }
  .chips { padding-inline: 20px; }
  .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); padding: 6px 20px 34px; }
  .list { padding-inline: 20px; }
  .notice, .panel { width: calc(100% - 40px); margin-inline: 20px; }
  .detail { width: calc(100% - 40px); grid-template-columns: 1fr; gap: 24px; margin: 8px 20px 40px; }
  .detail-media { max-width: 520px; }
}
@media (max-width: 720px) {
  .brand-name, .header-right > .muted { display: none; }
  .header { min-height: 62px; }
  .grid { grid-template-columns: 1fr; }
  .toolbar { flex-wrap: wrap; }
  .sort { margin-left: 0; }
}
`;

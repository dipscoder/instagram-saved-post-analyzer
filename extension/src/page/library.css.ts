/**
 * A self-contained visual system for the Shadow DOM library.
 *
 * Light by default, dark when the host carries `data-theme="dark"` (the popup and the
 * library share the setting). The page is a gallery first: pictures carry the colour,
 * the chrome stays quiet, warm neutrals, one violet for whatever is selected.
 */
export const styles = /* css */ `
:host {
  --canvas: #f7f6f3;
  --surface: #ffffff;
  --surface-2: #efeeea;
  --surface-3: #e6e4df;
  --line: rgba(28, 25, 23, 0.08);
  --line-strong: rgba(28, 25, 23, 0.15);
  --text: #1c1917;
  --text-2: #57534e;
  --text-3: #a29d97;
  --accent: #6d4aff;
  --accent-strong: #5b36f2;
  --accent-wash: #f0ecff;
  --ink: #1c1917;
  --on-ink: #ffffff;
  --danger: #d92d48;
  --on-danger: #ffffff;
  --frame: rgba(28, 25, 23, 0.06);
  --shadow-sm: 0 1px 2px rgba(28, 25, 23, 0.05), 0 1px 1px rgba(28, 25, 23, 0.03);
  --shadow-md: 0 2px 6px rgba(28, 25, 23, 0.05), 0 12px 32px rgba(28, 25, 23, 0.08);
  --shadow-lg: 0 6px 16px rgba(28, 25, 23, 0.08), 0 24px 60px rgba(28, 25, 23, 0.14);
  --search-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='none' stroke='%23a29d97' stroke-width='1.8' stroke-linecap='round'%3E%3Ccircle cx='7' cy='7' r='5'/%3E%3Cpath d='m11 11 3.2 3.2'/%3E%3C/svg%3E");
  --sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, "Segoe UI", system-ui, sans-serif;
  --display: -apple-system, BlinkMacSystemFont, "SF Pro Display", Inter, "Segoe UI", system-ui, sans-serif;
  color-scheme: light;
}

:host([data-theme="dark"]) {
  --canvas: #121211;
  --surface: #1c1c1a;
  --surface-2: #262624;
  --surface-3: #31312e;
  --line: rgba(255, 255, 255, 0.07);
  --line-strong: rgba(255, 255, 255, 0.14);
  --text: #f5f5f4;
  --text-2: #b4afa8;
  --text-3: #79746d;
  --accent: #a78bfa;
  --accent-strong: #c4b1ff;
  --accent-wash: rgba(167, 139, 250, 0.14);
  --ink: #f5f5f4;
  --on-ink: #121211;
  --danger: #ff6b81;
  --on-danger: #1a0d10;
  --frame: rgba(255, 255, 255, 0.06);
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
  --shadow-md: 0 2px 6px rgba(0, 0, 0, 0.3), 0 12px 32px rgba(0, 0, 0, 0.3);
  --shadow-lg: 0 6px 16px rgba(0, 0, 0, 0.35), 0 24px 60px rgba(0, 0, 0, 0.45);
  --search-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='none' stroke='%2379746d' stroke-width='1.8' stroke-linecap='round'%3E%3Ccircle cx='7' cy='7' r='5'/%3E%3Cpath d='m11 11 3.2 3.2'/%3E%3C/svg%3E");
  color-scheme: dark;
}

* { box-sizing: border-box; }
[hidden] { display: none !important; }
:where(button, input, select, a):focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; }
svg { display: block; }
.muted { color: var(--text-3); }
.num { font-variant-numeric: tabular-nums; }

.app {
  display: flex; flex-direction: column; height: 100%; overflow: hidden;
  background: var(--canvas); color: var(--text);
  font: 400 14px/1.5 var(--sans); letter-spacing: -0.006em; -webkit-font-smoothing: antialiased;
  transition: background 200ms ease, color 200ms ease;
}

/* Buttons. Ink for the one thing to do, quiet for the rest. */
.link {
  min-height: 30px; padding: 4px 0; color: var(--accent);
  font-size: 13px; font-weight: 550; text-align: left;
}
.link:hover { color: var(--accent-strong); }
.ghost, .pill, .primary {
  display: inline-flex; min-height: 36px; align-items: center; justify-content: center; gap: 6px;
  border-radius: 10px; padding: 7px 15px; font-size: 13px; font-weight: 600; white-space: nowrap;
  text-decoration: none; transition: background 140ms ease, border-color 140ms ease, color 140ms ease, opacity 140ms ease;
}
.ghost { border: 1px solid var(--line-strong); background: var(--surface); color: var(--text); }
.ghost:hover { background: var(--surface-2); }
.pill, .primary { background: var(--ink); color: var(--on-ink); }
.pill:hover, .primary:hover { opacity: 0.86; }
.pill.danger { background: var(--danger); color: var(--on-danger); }
.primary { margin-top: 14px; }

/* Header */
.header {
  flex: none; height: 64px; display: flex; align-items: center; gap: 20px;
  padding: 0 24px; border-bottom: 1px solid var(--line); background: var(--canvas);
}
.brand { flex: none; width: 196px; display: flex; align-items: center; gap: 10px; }
.brand-mark {
  position: relative; flex: none; width: 28px; height: 28px; border-radius: 8px;
  background: linear-gradient(135deg, #ff6a55, #f03e86 52%, #7a4cff);
}
.brand-mark::before {
  content: ""; position: absolute; left: 8.5px; top: 6.5px; width: 11px; height: 15px;
  border-radius: 2.5px 2.5px 1.5px 1.5px; background: #fff;
  clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 72%, 0 100%);
}
.brand-name { font: 650 15px/1 var(--display); letter-spacing: -0.02em; }
.search {
  flex: 1; max-width: 560px; height: 40px; border: 1px solid var(--line); border-radius: 11px;
  padding: 0 14px 0 38px; background: var(--surface) var(--search-icon) no-repeat 13px center;
  color: var(--text); font: 400 14px var(--sans); box-shadow: var(--shadow-sm);
  transition: border-color 140ms ease, box-shadow 140ms ease;
}
.search::placeholder { color: var(--text-3); }
.search:hover { border-color: var(--line-strong); }
.search:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 4px var(--accent-wash); }
.search::-webkit-search-cancel-button { opacity: 0.5; }
.header-right { margin-left: auto; display: flex; align-items: center; gap: 10px; }
.status-label { display: inline-flex; align-items: center; gap: 7px; color: var(--text-2); font-size: 12.5px; white-space: nowrap; }
.status-label::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--text-3); }
.status-label.done::before { background: #22a06b; }
.status-label.busy::before { background: var(--accent); animation: pulse 1.4s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: 0.35; } }
.icon-btn {
  width: 36px; height: 36px; display: grid; place-items: center; border-radius: 10px; color: var(--text-2);
  transition: background 140ms ease, color 140ms ease;
}
.icon-btn:hover { background: var(--surface-2); color: var(--text); }
.seg { display: inline-flex; align-items: center; gap: 2px; padding: 3px; border-radius: 10px; background: var(--surface-2); }
.seg-btn {
  min-height: 28px; display: inline-flex; align-items: center; gap: 6px; padding: 4px 11px; border-radius: 7px;
  color: var(--text-2); font-size: 12.5px; font-weight: 550; transition: color 140ms ease, background 140ms ease;
}
.seg-btn:hover { color: var(--text); }
.seg-btn.on { background: var(--surface); color: var(--text); box-shadow: var(--shadow-sm); }
:host([data-theme="dark"]) .seg-btn.on { background: var(--surface-3); }
.seg-where .seg-btn { min-height: 30px; padding-inline: 13px; }

/* Layout */
.body { min-height: 0; flex: 1; display: flex; overflow: hidden; }
.col { min-width: 0; flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.rail, .main { overscroll-behavior: contain; }
.rail {
  width: 244px; flex: none; display: flex; flex-direction: column; gap: 2px;
  overflow-y: auto; padding: 20px 14px 18px 18px;
}
.rail-row {
  width: 100%; min-height: 34px; display: flex; align-items: center; gap: 10px;
  padding: 6px 10px; border-radius: 9px; color: var(--text-2);
  font-size: 13.5px; font-weight: 500; text-align: left;
  transition: background 120ms ease, color 120ms ease;
}
.rail-row > span:nth-child(2) { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rail-row:hover { background: var(--surface-2); color: var(--text); }
.rail-row.on { background: var(--surface); color: var(--text); font-weight: 600; box-shadow: var(--shadow-sm); }
:host([data-theme="dark"]) .rail-row.on { background: var(--surface-2); }
.dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: oklch(0.7 0.13 var(--hue)); }
.dot-all { background: var(--ink); }
.dot-none { background: transparent; box-shadow: inset 0 0 0 1.5px var(--text-3); }
.rail-row .count { flex: none; color: var(--text-3); font-size: 12px; font-variant-numeric: tabular-nums; }
.divider { height: 1px; margin: 12px 10px; background: var(--line); }
.rail-label { padding: 4px 10px 6px; color: var(--text-3); font-size: 11.5px; font-weight: 600; }
.rail-hint { padding: 6px 10px 2px; color: var(--text-3); font-size: 12px; line-height: 1.5; }
.rail-foot { margin-top: auto; display: flex; flex-direction: column; gap: 6px; padding: 16px 10px 0; }
.main { flex: 1; overflow-y: auto; }
.toolbar { flex: none; display: flex; align-items: center; gap: 10px; padding: 26px 32px 18px; }
.back {
  min-height: 32px; margin-left: -10px; padding: 5px 10px; border-radius: 9px;
  color: var(--text-2); font-size: 13px; font-weight: 550;
}
.back:hover { background: var(--surface-2); color: var(--text); }
.title { margin: 0; font: 700 26px/1.2 var(--display); letter-spacing: -0.03em; }
.count-label { color: var(--text-3); font: 500 15px/1 var(--display); font-variant-numeric: tabular-nums; padding-top: 4px; }
.sort { margin-left: auto; display: flex; align-items: center; }
.sort select {
  min-height: 32px; appearance: none; border: 0; border-radius: 9px;
  padding: 5px 28px 5px 10px; background: transparent no-repeat;
  background-image: linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%);
  background-size: 4px 4px, 4px 4px; background-position: right 14px center, right 10px center;
  color: var(--text-2); font: 550 13px var(--sans); cursor: pointer;
}
.sort select:hover { background-color: var(--surface-2); color: var(--text); }
.sort select:focus:not(:focus-visible) { outline: none; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 32px 14px; }
.chip {
  display: inline-flex; align-items: center; gap: 6px; min-height: 28px; padding: 3px 10px;
  border-radius: 999px; background: var(--accent-wash); color: var(--accent); font-size: 12.5px; font-weight: 600;
}
.chip .x { opacity: 0.6; }

/* Status strip and notices */
.notice, .panel {
  max-width: 1240px; margin: 0 32px 22px; padding: 16px 18px;
  border: 1px solid var(--line); border-radius: 14px; background: var(--surface); box-shadow: var(--shadow-sm);
}
.notice { display: flex; align-items: center; gap: 18px; }
.notice-body { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 2px; }
.notice-title { font-size: 14px; font-weight: 650; }
.notice p { max-width: 70ch; margin: 0; color: var(--text-2); font-size: 13px; line-height: 1.5; }
.notice-actions { flex: none; display: flex; align-items: center; gap: 14px; }
.panel { display: flex; flex-direction: column; gap: 12px; }
.panel-top { display: flex; align-items: center; gap: 14px; }
.panel-text { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 1px; }
.panel-title { font-size: 14px; font-weight: 650; }
.panel-sub { color: var(--text-2); font-size: 13px; }
.panel-actions { flex: none; display: flex; align-items: center; gap: 4px; }
.panel-actions .pill { min-height: 34px; margin-right: 6px; }
.track { height: 4px; overflow: hidden; border-radius: 99px; background: var(--surface-2); }
.track-fill { height: 100%; border-radius: inherit; background: var(--accent); transition: width 240ms ease; }
.panel.paused .track-fill, .panel.error .track-fill { background: var(--text-3); }
.facts { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 12px; padding: 14px 0 2px; border-top: 1px solid var(--line); }
.fact { display: flex; flex-direction: column; gap: 1px; }
.fact-value { font: 650 17px/1.3 var(--display); letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.cap { color: var(--text-3); font-size: 12px; }
.panel-note { color: var(--text-2); font-size: 13px; line-height: 1.5; }
.panel-note.bad { color: var(--danger); }
.panel .link { align-self: flex-start; min-height: 0; padding: 0; }
.explain { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.explain-row { display: flex; flex-direction: column; gap: 4px; padding: 14px; border-radius: 11px; background: var(--canvas); }
.explain-title { font-size: 13px; font-weight: 650; }
.explain p { margin: 0; color: var(--text-2); font-size: 12.5px; line-height: 1.55; }
.x-btn { width: 32px; height: 32px; display: grid; place-items: center; border-radius: 9px; color: var(--text-3); font-size: 18px; line-height: 1; }
.x-btn:hover { background: var(--surface-2); color: var(--text); }

/* Results */
.grid {
  max-width: 1800px; display: grid; grid-template-columns: repeat(auto-fill, minmax(208px, 1fr));
  gap: 30px 22px; padding: 0 32px 56px;
}
.list { max-width: 1260px; display: flex; flex-direction: column; padding: 0 32px 56px; }
.card { min-width: 0; display: flex; flex-direction: column; color: inherit; text-decoration: none; border-radius: 14px; }
.thumb {
  position: relative; aspect-ratio: 4 / 5; overflow: hidden; display: flex; align-items: center; justify-content: center;
  border-radius: 14px; background: var(--surface-2); box-shadow: var(--shadow-sm);
  transition: box-shadow 200ms ease, transform 200ms ease;
}
/* A hairline over the picture, so white photos still have an edge on a light page. */
.thumb::after, .detail-media::after {
  content: ""; position: absolute; inset: 0; z-index: 3; border-radius: inherit;
  box-shadow: inset 0 0 0 1px var(--frame); pointer-events: none;
}
.card:hover .thumb { transform: translateY(-3px); box-shadow: var(--shadow-lg); }
.thumb img, .detail-media img {
  position: absolute; inset: 0; z-index: 1; width: 100%; height: 100%; object-fit: cover;
  opacity: 0; transition: opacity 220ms ease, transform 400ms ease;
}
.media-ready img { opacity: 1; }
.card:hover .media-ready img { transform: scale(1.03); }
.media-fallback {
  position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 10px;
  background: linear-gradient(160deg, var(--surface-2), var(--surface-3)); color: var(--text-3);
}
.media-fallback-mark {
  width: 22px; height: 28px; border: 1.5px solid currentColor; border-radius: 5px 5px 3px 3px;
  opacity: 0.7; clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 76%, 0 100%);
}
.media-fallback-label { font-size: 12px; font-weight: 550; }
.badge {
  position: absolute; z-index: 2; top: 10px; right: 10px; height: 24px; display: inline-flex; align-items: center; gap: 4px;
  padding: 0 8px 0 7px; border-radius: 999px; background: rgba(12, 12, 12, 0.5); color: #fff;
  font-size: 11.5px; font-weight: 600; font-variant-numeric: tabular-nums; backdrop-filter: blur(10px);
}
.card-body { display: flex; flex-direction: column; gap: 7px; padding: 12px 2px 0; }
.summary {
  overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  min-height: calc(2 * 1.42em); color: var(--text); font-size: 13.5px; font-weight: 550; line-height: 1.42;
}
.queued { color: var(--text-3); font-weight: 450; }
.meta { min-width: 0; display: flex; align-items: center; gap: 8px; font-size: 12px; }
.handle { min-width: 0; overflow: hidden; color: var(--text-3); text-overflow: ellipsis; white-space: nowrap; }
.date { flex: none; margin-left: auto; color: var(--text-3); cursor: help; font-variant-numeric: tabular-nums; }
.added { flex: none; color: var(--text-3); }
.cat {
  min-width: 0; max-width: 62%; flex: none; overflow: hidden; padding: 2px 8px; border-radius: 999px;
  background: oklch(0.95 0.035 var(--hue)); color: oklch(0.43 0.11 var(--hue));
  font-size: 11.5px; font-weight: 600; line-height: 1.5; text-overflow: ellipsis; white-space: nowrap;
}
.cat-none { background: var(--surface-2); color: var(--text-3); }
:host([data-theme="dark"]) .cat { background: oklch(0.3 0.045 var(--hue)); color: oklch(0.86 0.07 var(--hue)); }
:host([data-theme="dark"]) .cat-none { background: var(--surface-2); color: var(--text-3); }
.list .card { flex-direction: row; align-items: center; gap: 16px; padding: 10px; margin: 0 -10px; border-radius: 12px; }
.list .card:hover { background: var(--surface); box-shadow: var(--shadow-sm); }
.list .thumb { width: 56px; height: 56px; flex: none; aspect-ratio: auto; border-radius: 10px; box-shadow: none; }
.list .card:hover .thumb { transform: none; box-shadow: none; }
.list .media-fallback-label, .list .badge { display: none; }
.list .card-body { min-width: 0; flex: 1; flex-direction: row; align-items: center; gap: 16px; padding: 0; }
.list .summary { min-height: 0; flex: 1; -webkit-line-clamp: 1; }
.list .meta { flex: 0 1 44%; }
.list .date { margin-left: 12px; }
.more { display: flex; align-items: center; justify-content: center; gap: 14px; padding: 0 32px 48px; }

/* Post detail */
.detail {
  max-width: 1080px; display: grid; grid-template-columns: minmax(300px, 46%) minmax(300px, 1fr);
  align-items: start; gap: 40px; margin: 0 32px 56px; padding: 24px;
  border: 1px solid var(--line); border-radius: 20px; background: var(--surface); box-shadow: var(--shadow-sm);
}
.detail-media {
  position: relative; aspect-ratio: 4 / 5; overflow: hidden; display: flex;
  align-items: center; justify-content: center; border-radius: 14px; background: var(--surface-2);
}
.detail-info { min-width: 0; display: flex; flex-direction: column; gap: 18px; padding: 8px 8px 8px 0; }
.detail-heading { display: flex; align-items: center; gap: 10px; font-size: 13px; }
.detail-summary { margin: 0; font: 700 24px/1.3 var(--display); letter-spacing: -0.025em; }
.detail-facts {
  display: grid; grid-template-columns: 110px minmax(0, 1fr); gap: 10px 16px;
  margin: 0; padding: 18px 0; border-block: 1px solid var(--line); font-size: 13px; line-height: 1.5;
}
.detail-facts dt { color: var(--text-3); }
.detail-facts dd { margin: 0; overflow-wrap: anywhere; color: var(--text); }
.detail-label { color: var(--text-3); font-size: 12px; font-weight: 600; }
.detail-caption { max-height: 240px; overflow: auto; margin: -10px 0 0; color: var(--text-2); font-size: 13.5px; line-height: 1.65; white-space: pre-wrap; }
.detail-status { padding: 11px 13px; border-radius: 10px; background: var(--accent-wash); color: var(--text); font-size: 13px; line-height: 1.5; }
.detail-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }

/* Empty and restore states */
.empty { min-height: 440px; display: flex; flex: 1; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 70px 36px; text-align: center; }
.empty-mark {
  position: relative; width: 52px; height: 52px; margin-bottom: 12px; border-radius: 15px;
  background: linear-gradient(135deg, #ff6a55, #f03e86 52%, #7a4cff); box-shadow: 0 12px 30px rgba(240, 62, 134, 0.22);
}
.empty-mark::before {
  content: ""; position: absolute; left: 16px; top: 12px; width: 20px; height: 27px;
  border-radius: 4px; background: #fff; clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 73%, 0 100%);
}
.empty-title { font: 700 19px/1.3 var(--display); letter-spacing: -0.02em; }
.empty-detail { max-width: 400px; color: var(--text-2); font-size: 13.5px; line-height: 1.6; }
.restore {
  position: absolute; right: 22px; bottom: 22px; pointer-events: auto;
  display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 8px 14px 8px 8px;
  border: 1px solid var(--line); border-radius: 14px; background: var(--surface); color: var(--text);
  font: 600 13px var(--sans); box-shadow: var(--shadow-lg); transition: transform 140ms ease;
}
.restore:hover { transform: translateY(-1px); }
.restore .brand-mark { width: 26px; height: 26px; }
.restore .brand-mark::before { left: 8px; top: 6px; width: 10px; height: 14px; }
.restore-key { color: var(--text-3); font-size: 12px; }

@media (max-width: 1400px) { .explain { grid-template-columns: 1fr; } .facts { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 1050px) {
  .rail { display: none; }
  .brand { width: auto; }
  .header { padding-inline: 18px; gap: 14px; }
  .toolbar { padding: 22px 20px 16px; }
  .chips { padding-inline: 20px; }
  .grid { grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); padding: 0 20px 40px; }
  .list { padding-inline: 20px; }
  .notice, .panel { margin-inline: 20px; }
  .detail { grid-template-columns: 1fr; gap: 24px; margin: 0 20px 40px; }
  .detail-media { max-width: 520px; }
}
@media (max-width: 720px) {
  .brand-name, .status-label { display: none; }
  .toolbar { flex-wrap: wrap; }
  .sort { margin-left: 0; }
}
`;

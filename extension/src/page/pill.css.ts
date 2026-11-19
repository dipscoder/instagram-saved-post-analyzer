/** The pill's styles, inside its Shadow DOM. Light by default, dark on data-theme="dark". */
export const styles = /* css */ `
:host {
  --surface: #ffffff;
  --surface-2: #efeeea;
  --line: rgba(28, 25, 23, 0.08);
  --text: #1c1917;
  --text-2: #57534e;
  --ink: #1c1917;
  --on-ink: #ffffff;
  --danger: #d92d48;
  --on-danger: #ffffff;
  --shadow: 0 6px 16px rgba(28, 25, 23, 0.08), 0 24px 60px rgba(28, 25, 23, 0.14);
  --sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, "Segoe UI", system-ui, sans-serif;
  color-scheme: light;
}
:host([data-theme="dark"]) {
  --surface: #1c1c1a;
  --surface-2: #262624;
  --line: rgba(255, 255, 255, 0.07);
  --text: #f5f5f4;
  --text-2: #b4afa8;
  --ink: #f5f5f4;
  --on-ink: #121211;
  --danger: #ff6b81;
  --on-danger: #1a0d10;
  --shadow: 0 6px 16px rgba(0, 0, 0, 0.35), 0 24px 60px rgba(0, 0, 0, 0.45);
  color-scheme: dark;
}
* { box-sizing: border-box; }
.dock {
  display: flex; align-items: center; gap: 10px; max-width: min(560px, calc(100vw - 120px));
  padding: 6px 6px 6px 8px; border: 1px solid var(--line); border-radius: 999px;
  background: var(--surface); color: var(--text); font: 500 13px var(--sans); box-shadow: var(--shadow);
  -webkit-font-smoothing: antialiased;
}
/* The Notch mark: a tile with a bookmark notch cut from its foot. */
.brand-mark {
  flex: none; width: 20px; height: 20px; margin-left: 4px; background: var(--text);
  clip-path: polygon(14% 4%, 86% 4%, 86% 96%, 50% 70%, 14% 96%);
}
.dock-text { display: flex; flex-direction: column; min-width: 0; line-height: 1.25; }
.dock-name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dock-status { color: var(--text-2); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dock-action, .dock-open {
  flex: none; display: inline-flex; align-items: center; min-height: 32px; padding: 0 14px;
  border-radius: 999px; font: 600 12.5px var(--sans); cursor: pointer; text-decoration: none;
}
.dock-action { border: 0; background: var(--ink); color: var(--on-ink); }
.dock-action.danger { background: var(--danger); color: var(--on-danger); }
.dock-action:hover { opacity: 0.86; }
.dock-open { border: 1px solid var(--line); background: transparent; color: var(--text); }
.dock-open:hover { background: var(--surface-2); }
.dock button:focus-visible, .dock a:focus-visible { outline: 2px solid var(--text); outline-offset: 2px; }
`;

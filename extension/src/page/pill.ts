/**
 * The pill: the only thing the extension shows on instagram.com.
 *
 * Inside a saved collection, a small pill in the corner names the collection, says what
 * is happening, finds new posts by scrolling, and links to the web app, where the library
 * and every control live. Instagram stays fully usable underneath, and nothing here
 * listens to keys on Instagram's document.
 *
 * Rendered into a Shadow DOM so Instagram's stylesheet cannot reach our markup and ours
 * cannot leak into theirs. Mounted in `document.body`, outside React's root, so React
 * re-renders never tear it out.
 */

import { send, subscribe, type Broadcast } from '../messaging';
import { startHarvest, type HarvestHandle } from '../capture/bridge';
import { isFullSavedFeed, type SavedCollection } from '../routes';
import { WEB_APP_URL } from '../config';
import type { Settings, Theme } from '../types';
import { pillButton, pillStatus, type PillState } from './flow';
import { styles } from './pill.css';

const state: PillState & {
  /** When the current sweep began: the cutoff a stray is measured against. */
  sweepStartedAt: number;
  /**
   * Whether the sweep in progress began on the *full* saved feed. Latched when it
   * starts, because walking into All posts mid-sweep must not turn a sweep of one
   * collection into a census of the whole library (invariant 3).
   */
  sweepWasFullFeed: boolean;
} = {
  finding: false,
  total: 0,
  strays: 0,
  confirming: false,
  message: null,
  sweepStartedAt: 0,
  sweepWasFullFeed: false,
};

let host: HTMLDivElement | null = null;
let collection: SavedCollection = { id: 'all-posts', name: 'All posts' };
let elName: HTMLElement | null = null;
let elStatus: HTMLElement | null = null;
let elAction: HTMLButtonElement | null = null;
let unsubscribe: (() => void) | null = null;
let harvest: HarvestHandle | null = null;

export function mountPill(where: SavedCollection): void {
  if (host) return;
  collection = where;

  host = document.createElement('div');
  host.setAttribute('data-saved-index', 'pill');
  Object.assign(host.style, {
    position: 'fixed',
    right: '24px',
    bottom: '24px',
    zIndex: '2147482000',
  } satisfies Partial<CSSStyleDeclaration>);

  const shadow = host.attachShadow({ mode: 'open' });
  const sheet = document.createElement('style');
  sheet.textContent = styles;
  shadow.append(sheet, build());
  document.body.appendChild(host);

  unsubscribe = subscribe(onBroadcast);
  void send<Settings>({ type: 'settings:get' })
    .then((settings) => applyTheme(settings.theme))
    .catch(() => {});
  void refresh();
  render();
}

export function unmountPill(): void {
  if (harvest) void send({ type: 'harvest:finished', reason: 'stopped' }).catch(() => {});
  stopFinding();
  // State is a module singleton: anything not reset here comes back on the next mount.
  state.strays = 0;
  state.confirming = false;
  state.message = null;
  unsubscribe?.();
  unsubscribe = null;
  host?.remove();
  host = null;
  elName = elStatus = elAction = null;
}

export function isPillMounted(): boolean {
  return host !== null;
}

function build(): HTMLElement {
  const pill = h('div', 'dock');
  pill.setAttribute('role', 'region');
  pill.setAttribute('aria-label', 'Saved Index');

  elName = h('span', 'dock-name');
  elStatus = h('span', 'dock-status');
  elStatus.setAttribute('aria-live', 'polite');

  elAction = h('button', 'dock-action');
  elAction.addEventListener('click', () => void onAction());

  const open = h('a', 'dock-open', 'Open library ↗');
  open.href = WEB_APP_URL;
  open.target = '_blank';
  open.rel = 'noopener';

  pill.append(h('span', 'brand-mark'), h('span', 'dock-text', [elName, elStatus]), elAction, open);
  return pill;
}

function render(): void {
  if (!elName || !elStatus || !elAction) return;
  elName.textContent = collection.name;
  elStatus.textContent = pillStatus(state);
  const button = pillButton(state);
  elAction.textContent = button.label;
  elAction.classList.toggle('danger', button.action === 'confirm-remove');
}

function onBroadcast(msg: Broadcast): void {
  if (msg.type === 'settings') return applyTheme(msg.settings.theme);
  if (msg.type === 'harvest') {
    // The worker cannot scroll; only this page can. A stop from elsewhere arrives here.
    if (msg.action === 'stop') stopFinding();
    else startFinding();
    return;
  }
  if (msg.type === 'found') {
    state.total = msg.total;
    render();
  }
}

async function refresh(): Promise<void> {
  try {
    state.total = await send<number>({ type: 'posts:count' });
  } catch {
    // Worker waking up; the next push fills it in.
  }
  render();
}

async function onAction(): Promise<void> {
  const { action } = pillButton(state);
  state.message = null;
  try {
    if (action === 'stop') {
      stopFinding();
      await send({ type: 'find:stop' });
    } else if (action === 'remove') {
      state.confirming = true;
    } else if (action === 'confirm-remove') {
      await send({ type: 'posts:prune', since: state.sweepStartedAt });
      state.strays = 0;
      state.confirming = false;
      await refresh();
    } else {
      // The worker answers with a harvest broadcast, which starts the scroll here.
      await send({ type: 'find:start' });
    }
  } catch (err) {
    state.message = err instanceof Error ? err.message : String(err);
  }
  render();
}

function startFinding(): void {
  if (harvest) return;
  state.finding = true;
  state.message = null;
  state.strays = 0;
  state.confirming = false;
  state.sweepStartedAt = Date.now();
  state.sweepWasFullFeed = isFullSavedFeed();
  const current = startHarvest();
  harvest = current;
  void current.done.then((result) => {
    // Stop then Find again quickly can leave the old sweep finishing after the new one
    // starts. Only the sweep that still owns the slot may change what is shown.
    if (harvest !== current) return;
    harvest = null;
    state.finding = false;
    if (result.reason === 'rate-limited') {
      state.message = 'Instagram slowed the page down, so scrolling stopped. Try again shortly.';
    }
    // Both conditions are load-bearing: the sweep reached the end, and it was a sweep of
    // the whole feed, or everything outside one collection would look unsaved.
    if (result.reason === 'complete' && state.sweepWasFullFeed) void countStrays();
    void send({ type: 'harvest:finished', reason: result.reason }).catch(() => {});
    void refresh();
  });
  render();
}

function stopFinding(): void {
  harvest?.stop();
  harvest = null;
  state.finding = false;
  render();
}

async function countStrays(): Promise<void> {
  try {
    const { count } = await send<{ count: number }>({ type: 'posts:strays', since: state.sweepStartedAt });
    state.strays = count;
    render();
  } catch {
    // Worker restarting. Nothing is lost: the next completed sweep asks again.
  }
}

function applyTheme(theme: Theme | undefined): void {
  host?.setAttribute('data-theme', theme === 'dark' ? 'dark' : 'light');
}

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  content?: string | (Node | string)[],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (typeof content === 'string') el.textContent = content;
  else if (Array.isArray(content)) el.append(...content);
  return el;
}

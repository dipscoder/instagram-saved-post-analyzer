/**
 * The in-page library that takes over instagram.com/…/saved.
 *
 * Rendered into a Shadow DOM so Instagram's stylesheet can't reach our markup and ours
 * can't leak into theirs. Mounted as a fixed overlay anchored to the right of Instagram's
 * icon rail rather than by replacing grid nodes: React owns that subtree and re-renders
 * would tear our nodes straight back out. The visual result is the same — you see the
 * library where the grid was — without fighting the framework.
 */

import { send, subscribe, type Broadcast, type Stats } from '../messaging';
import { startHarvest, type HarvestHandle } from '../capture/bridge';
import { CATEGORY_NAMES, UNCATEGORIZED } from '../taxonomy';
import { IDLE_PROGRESS, type IndexProgress, type PostRecord } from '../types';
import { styles } from './library.css';

const NAV_RAIL_PX = 72; // Instagram's own icon rail; left visible and usable
const PAGE_SIZE = 200;

interface State {
  posts: PostRecord[];
  stats: Stats;
  progress: IndexProgress;
  search: string;
  selected: Set<string>;
  view: 'grid' | 'list';
  visible: boolean;
  loading: boolean;
  stripDismissed: boolean;
  /** True while the page is auto-scrolling to surface more posts. */
  harvesting: boolean;
}

const state: State = {
  posts: [],
  stats: { total: 0, categorized: 0, byCategory: {}, lastRunAt: null },
  progress: IDLE_PROGRESS,
  search: '',
  selected: new Set(),
  view: 'grid',
  visible: true,
  loading: true,
  stripDismissed: false,
  harvesting: false,
};

let host: HTMLDivElement | null = null;
let shadow: ShadowRoot | null = null;
let searchDebounce = 0;

export function mountLibrary(): void {
  if (host) return;

  host = document.createElement('div');
  host.setAttribute('data-saved-index', 'library');
  Object.assign(host.style, {
    position: 'fixed',
    inset: `0 0 0 ${NAV_RAIL_PX}px`,
    zIndex: '2147482000',
  } satisfies Partial<CSSStyleDeclaration>);

  shadow = host.attachShadow({ mode: 'open' });
  const sheet = document.createElement('style');
  sheet.textContent = styles;
  shadow.append(sheet, document.createElement('div'));
  document.body.appendChild(host);

  subscribe(onBroadcast);
  void refresh();
  render();
}

export function unmountLibrary(): void {
  host?.remove();
  host = null;
  shadow = null;
}

export function isLibraryMounted(): boolean {
  return host !== null;
}

function onBroadcast(msg: Broadcast): void {
  if (msg.type !== 'progress') return;
  const moved =
    msg.progress.categorized !== state.stats.categorized ||
    msg.progress.total !== state.stats.total;
  state.progress = msg.progress;
  // Cards fill in as they're written, and newly captured posts appear as they scroll
  // past — either count moving means the rows on screen are stale.
  if (moved) void refresh();
  else render();
}

async function refresh(): Promise<void> {
  try {
    const [posts, stats] = await Promise.all([
      send<PostRecord[]>({
        type: 'posts:query',
        search: state.search,
        categories: [...state.selected],
        limit: PAGE_SIZE,
      }),
      send<Stats>({ type: 'posts:stats' }),
    ]);
    state.posts = posts;
    state.stats = stats;
  } catch {
    // Service worker restarting; the next progress push will retry.
  } finally {
    state.loading = false;
    render();
  }
}

// --- rendering --------------------------------------------------------------

function render(): void {
  if (!shadow || !host) return;
  host.style.display = state.visible ? 'block' : 'none';
  const root = shadow.lastElementChild as HTMLDivElement;
  root.className = 'app';
  root.replaceChildren(header(), body());
}

function header(): HTMLElement {
  const el = h('header', 'header');

  el.append(
    h('div', 'brand', [h('span', 'dot'), h('span', 'brand-name', 'Saved Index')]),
  );

  const search = document.createElement('input');
  search.className = 'search';
  search.placeholder = 'Search summaries, handles, captions';
  search.value = state.search;
  search.addEventListener('input', () => {
    state.search = search.value;
    clearTimeout(searchDebounce);
    searchDebounce = self.setTimeout(() => void refresh(), 160);
  });
  el.append(search);

  const right = h('div', 'header-right');
  right.append(h('span', 'mono muted', indexLabel()));

  const toggle = h('div', 'seg');
  for (const view of ['grid', 'list'] as const) {
    const b = h('button', `seg-btn${state.view === view ? ' on' : ''}`, cap(view));
    b.addEventListener('click', () => {
      state.view = view;
      render();
    });
    toggle.append(b);
  }
  right.append(toggle);

  const hide = h('button', 'ghost', 'Hide');
  hide.title = "Hide the library and show Instagram's own grid";
  hide.addEventListener('click', () => {
    state.visible = false;
    render();
    showRestoreChip();
  });
  right.append(hide);

  el.append(right);
  return el;
}

function body(): HTMLElement {
  const el = h('div', 'body');
  el.append(rail(), main());
  return el;
}

function rail(): HTMLElement {
  const el = h('aside', 'rail');

  const all = h('button', `rail-row${state.selected.size === 0 ? ' on' : ''}`, [
    h('span', '', 'All saved'),
    h('span', 'mono count', String(state.stats.total)),
  ]);
  all.addEventListener('click', () => {
    state.selected.clear();
    void refresh();
  });
  el.append(all, h('div', 'divider'), h('div', 'rail-label', 'Categories'));

  for (const name of CATEGORY_NAMES) {
    const count = state.stats.byCategory[name] ?? 0;
    if (count === 0 && !state.selected.has(name)) continue;
    el.append(railRow(name, count));
  }

  const uncat = state.stats.byCategory[UNCATEGORIZED] ?? 0;
  if (uncat > 0) el.append(h('div', 'divider'), railRow(UNCATEGORIZED, uncat));

  const foot = h('div', 'rail-foot');
  foot.append(h('div', 'mono muted', indexLabel()));

  const action = h('button', 'link', reindexLabel());
  action.addEventListener('click', () => void onIndexAction());
  foot.append(action);
  el.append(foot);

  return el;
}

function railRow(name: string, count: number): HTMLElement {
  const on = state.selected.has(name);
  const row = h('button', `rail-row${on ? ' on' : ''}`, [
    h('span', '', name),
    h('span', 'mono count', String(count)),
  ]);
  row.addEventListener('click', () => {
    if (on) state.selected.delete(name);
    else state.selected.add(name);
    void refresh();
  });
  return row;
}

function main(): HTMLElement {
  const el = h('main', 'main');

  if (!state.stripDismissed && (state.progress.phase !== 'idle' || state.harvesting)) {
    el.append(strip());
  }

  const head = h('div', 'main-head');
  const title = state.selected.size ? [...state.selected].join(', ') : 'All saved';
  head.append(h('h1', 'title', title), h('span', 'mono muted', `${state.posts.length}`));

  if (state.selected.size) {
    const chips = h('div', 'chips');
    for (const name of state.selected) {
      const chip = h('button', 'chip', [h('span', '', name), h('span', 'x', '×')]);
      chip.addEventListener('click', () => {
        state.selected.delete(name);
        void refresh();
      });
      chips.append(chip);
    }
    const clear = h('button', 'link', 'Clear');
    clear.addEventListener('click', () => {
      state.selected.clear();
      state.search = '';
      void refresh();
    });
    chips.append(clear);
    head.append(chips);
  }
  el.append(head);

  if (state.loading) {
    el.append(empty('Loading…', 'Reading what has been indexed so far.'));
    return el;
  }

  const blocker = blockingState();
  if (blocker) {
    el.append(blocker);
    return el;
  }

  if (!state.posts.length) {
    el.append(
      empty(
        'Nothing matches',
        'Try a shorter query, or drop a category.',
        state.search || state.selected.size ? { label: 'Clear filters', run: clearFilters } : undefined,
      ),
    );
    return el;
  }

  const list = h('div', state.view === 'grid' ? 'grid' : 'list');
  for (const post of state.posts) list.append(card(post));
  el.append(list);
  return el;
}

/** The one full-panel state that outranks the grid, or null to show results. */
function blockingState(): HTMLElement | null {
  if (state.stats.total === 0) {
    return empty(
      'Nothing captured yet',
      'Scroll your saved posts and they will be picked up automatically, or run a full pass now.',
      { label: 'Index now', run: () => void onIndexAction() },
    );
  }
  if (state.progress.phase === 'error' && state.stats.categorized === 0) {
    return empty('Indexing stopped', state.progress.message ?? 'Something went wrong.', {
      label: 'Retry',
      run: () => void send({ type: 'index:start' }),
    });
  }
  return null;
}

function strip(): HTMLElement {
  const p = state.progress;
  const pct = p.total ? (p.categorized / p.total) * 100 : 0;
  const running = p.phase === 'running';

  const el = h('div', `strip ${p.phase}`);
  const bar = h('div', 'strip-main');

  const top = h('div', 'strip-top');
  top.append(
    h('span', 'mono', `${p.categorized} of ${p.total} categorized${running ? '' : ` · ${p.phase}`}`),
  );
  const action = h('button', 'link', running ? 'Pause' : 'Resume');
  action.addEventListener('click', () =>
    void send({ type: running ? 'index:pause' : 'index:start' }),
  );
  top.append(action);

  const track = h('div', 'track');
  const fill = h('div', 'track-fill');
  fill.style.width = `${pct}%`;
  track.append(fill);
  bar.append(top, track);

  const dismiss = h('button', 'x-btn', '×');
  dismiss.title = 'Dismiss for this session — indexing continues';
  dismiss.addEventListener('click', () => {
    state.stripDismissed = true;
    render();
  });

  el.append(bar, dismiss);

  const note = state.harvesting
    ? 'Scrolling your saved posts to find everything — leave this tab open.'
    : p.message;
  if (note) el.append(h('div', 'strip-note', note));
  return el;
}

function card(post: PostRecord): HTMLElement {
  const el = h('a', 'card');
  (el as HTMLAnchorElement).href = post.permalink;
  (el as HTMLAnchorElement).target = '_blank';
  (el as HTMLAnchorElement).rel = 'noopener';

  const thumb = h('div', 'thumb');
  if (post.thumbnailUrl) {
    const img = document.createElement('img');
    img.src = post.thumbnailUrl;
    img.loading = 'lazy';
    img.alt = post.altText ?? '';
    thumb.append(img);
  }
  if (post.isVideo) thumb.append(h('span', 'mono kind', 'REEL'));
  if (post.durationSec) thumb.append(h('span', 'mono dur', fmtDuration(post.durationSec)));
  el.append(thumb);

  // The summary line keeps its box whether or not it is filled, so a card never
  // jumps when its summary lands.
  el.append(
    post.categorizedAt
      ? h('div', 'summary', post.summary ?? post.caption.slice(0, 90) ?? '')
      : h('div', 'summary mono queued', 'in queue'),
  );

  const meta = h('div', 'meta');
  meta.append(chipFor(post.category), h('span', 'mono handle', post.handle));
  if (post.savedAt) meta.append(h('span', 'mono date', fmtDate(post.savedAt)));
  el.append(meta);

  return el;
}

function chipFor(category: string | null): HTMLElement {
  const name = category ?? UNCATEGORIZED;
  const el = h('span', `cat${category ? '' : ' cat-none'}`, name);
  el.style.setProperty('--hue', String(hueFor(name)));
  return el;
}

function empty(
  title: string,
  detail: string,
  action?: { label: string; run: () => void },
): HTMLElement {
  const el = h('div', 'empty');
  el.append(h('div', 'empty-mark'), h('div', 'empty-title', title), h('div', 'empty-detail', detail));
  if (action) {
    const btn = h('button', 'primary', action.label);
    btn.addEventListener('click', action.run);
    el.append(btn);
  }
  return el;
}

/** A small chip so the library can be brought back after Hide. */
function showRestoreChip(): void {
  const chip = document.createElement('button');
  chip.textContent = 'Saved Index';
  chip.setAttribute('data-saved-index', 'restore');
  Object.assign(chip.style, {
    position: 'fixed',
    right: '16px',
    bottom: '16px',
    zIndex: '2147482001',
    padding: '8px 12px',
    borderRadius: '8px',
    border: '1px solid rgba(125,125,125,0.35)',
    background: 'Canvas',
    color: 'CanvasText',
    font: '500 12px/1 system-ui, sans-serif',
    cursor: 'pointer',
  } satisfies Partial<CSSStyleDeclaration>);
  chip.addEventListener('click', () => {
    chip.remove();
    state.visible = true;
    render();
  });
  document.body.appendChild(chip);
}

// --- actions ----------------------------------------------------------------

async function onIndexAction(): Promise<void> {
  const phase = state.progress.phase;

  if (phase === 'running') {
    harvest?.stop();
    harvest = null;
    return void send({ type: 'index:pause' });
  }

  if (phase === 'done' && state.stats.categorized === state.stats.total && state.stats.total > 0) {
    return void send({ type: 'index:reindex' });
  }

  // Two halves, and they run together: the harvester scrolls the page so the capture
  // layer sees every saved post, while the worker categorises whatever has landed.
  // Only the page can scroll, so the harvester has to live here, not in the worker.
  startHarvesting();
  await send({ type: 'index:start' });
}

let harvest: HarvestHandle | null = null;

function startHarvesting(): void {
  if (harvest) return;
  state.harvesting = true;
  harvest = startHarvest();
  void harvest.done.then((result) => {
    harvest = null;
    state.harvesting = false;
    if (result.reason === 'rate-limited') {
      state.progress = {
        ...state.progress,
        phase: 'paused',
        message: 'Instagram rate-limited the page, so scrolling stopped. Try again shortly.',
      };
    }
    void refresh();
  });
  render();
}

function clearFilters(): void {
  state.selected.clear();
  state.search = '';
  void refresh();
}

// --- small helpers ----------------------------------------------------------

function indexLabel(): string {
  const { total, categorized } = state.stats;
  if (total === 0) return 'nothing captured yet';
  if (categorized === total) return `${total} indexed`;
  return `${categorized} of ${total} indexed`;
}

function reindexLabel(): string {
  switch (state.progress.phase) {
    case 'running':
      return 'Pause indexing';
    case 'paused':
    case 'error':
      return 'Resume indexing';
    case 'done':
      return 'Re-index';
    default:
      return 'Index now';
  }
}

/** Stable per-category hue so a chip keeps its colour across sessions. */
function hueFor(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % 360;
  return hash;
}

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
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

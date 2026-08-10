/**
 * The in-page library that takes over instagram.com/…/saved.
 *
 * Rendered into a Shadow DOM so Instagram's stylesheet can't reach our markup and ours
 * can't leak into theirs. Mounted as a fixed overlay anchored to the right of Instagram's
 * icon rail rather than by replacing grid nodes: React owns that subtree and re-renders
 * would tear our nodes straight back out. The visual result is the same — you see the
 * library where the grid was — without fighting the framework.
 *
 * The shell (header, rail frame, scroll container) is built once and mutated in place;
 * only the rail rows and the results list are rebuilt, and the scroll position is carried
 * across that swap. Rebuilding everything on each progress push is what made scrolling
 * feel like it was fighting back — a batch landing mid-scroll threw the grid back to the
 * top and dropped the caret out of the search box.
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
  /** Matches before the page limit. `posts.length` is only what is on screen. */
  matches: number;
  /** Grows by a page at a time; back to one page whenever the query changes. */
  limit: number;
  stats: Stats;
  progress: IndexProgress;
  search: string;
  /** One category unless you ⌘/Ctrl-click to build a comparison. */
  selected: Set<string>;
  view: 'grid' | 'list';
  visible: boolean;
  loading: boolean;
  panelDismissed: boolean;
  explainOpen: boolean;
  /** True while the page is auto-scrolling to surface more posts. */
  harvesting: boolean;
  /** When the current sweep began — the cutoff a stray is measured against. */
  sweepStartedAt: number;
  /** Records the last completed sweep did not find in the feed. */
  strays: number;
  straysDismissed: boolean;
}

const state: State = {
  posts: [],
  matches: 0,
  limit: PAGE_SIZE,
  stats: { total: 0, categorized: 0, byCategory: {}, lastRunAt: null },
  progress: IDLE_PROGRESS,
  search: '',
  selected: new Set(),
  view: 'grid',
  visible: true,
  loading: true,
  panelDismissed: false,
  explainOpen: false,
  harvesting: false,
  sweepStartedAt: 0,
  strays: 0,
  straysDismissed: false,
};

let host: HTMLDivElement | null = null;
let shadow: ShadowRoot | null = null;
let searchDebounce = 0;
/** Dropped on unmount — leaving on/off the saved route otherwise stacks up listeners. */
let unsubscribe: (() => void) | null = null;

// Persistent shell nodes — created once, mutated thereafter.
let elRail: HTMLElement | null = null;
let elMain: HTMLElement | null = null;
let elSearch: HTMLInputElement | null = null;
let elCount: HTMLElement | null = null;
let elSeg: HTMLElement | null = null;

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
  shadow.append(sheet, buildShell());
  document.body.appendChild(host);

  unsubscribe = subscribe(onBroadcast);
  void refresh();
  render();
}

export function unmountLibrary(): void {
  stopHarvesting();
  unsubscribe?.();
  unsubscribe = null;
  host?.remove();
  host = null;
  shadow = null;
  elRail = elMain = elSearch = elCount = elSeg = null;
}

export function isLibraryMounted(): boolean {
  return host !== null;
}

function onBroadcast(msg: Broadcast): void {
  if (msg.type === 'harvest') {
    // The worker cannot scroll; only this page can. A pause from the popup has to reach
    // the harvester through here.
    if (msg.action === 'stop') stopHarvesting();
    else startHarvesting();
    return;
  }
  if (msg.type !== 'progress') return;

  const moved =
    msg.progress.categorized !== state.stats.categorized ||
    msg.progress.total !== state.stats.total;
  state.progress = msg.progress;
  if (moved) queueRefresh();
  else render();
}

/**
 * A run writes in bursts — 25 rows at a time, three batches in flight. Coalescing means
 * one query and one repaint per burst rather than one per batch.
 */
let refreshQueued = 0;

function queueRefresh(): void {
  if (refreshQueued) return;
  refreshQueued = self.setTimeout(() => {
    refreshQueued = 0;
    void refresh();
  }, 250);
}

/**
 * Set when the *query* changed rather than the data. Preserving scroll is right for a
 * batch landing underneath you; it is wrong when you've just switched category, where
 * you expect to be looking at the top of a new list.
 */
let resetScroll = false;

function refreshFromTop(): void {
  resetScroll = true;
  // A new query is a new list; keeping page 3 of the old one makes no sense.
  state.limit = PAGE_SIZE;
  void refresh();
}

async function refresh(): Promise<void> {
  try {
    const [result, stats] = await Promise.all([
      send<{ posts: PostRecord[]; total: number }>({
        type: 'posts:query',
        search: state.search,
        categories: [...state.selected],
        limit: state.limit,
      }),
      send<Stats>({ type: 'posts:stats' }),
    ]);
    state.posts = result.posts;
    state.matches = result.total;
    state.stats = stats;
  } catch {
    // Service worker restarting; the next progress push will retry.
  } finally {
    state.loading = false;
    render();
  }
}

// --- shell ------------------------------------------------------------------

/** Built once. Everything here survives every render, so focus and caret survive too. */
function buildShell(): HTMLElement {
  const app = h('div', 'app');

  const header = h('header', 'header');
  header.append(h('div', 'brand', [h('span', 'dot'), h('span', 'brand-name', 'Saved Index')]));

  const search = document.createElement('input');
  search.className = 'search';
  search.placeholder = 'Search summaries, captions, tags, handles, alt text';
  search.title =
    'Every word has to match, in any order. Searches the summary, caption, category, ' +
    'subcategory, tags, hashtags, handle, alt text and audio track.';
  search.addEventListener('input', () => {
    state.search = search.value;
    clearTimeout(searchDebounce);
    searchDebounce = self.setTimeout(refreshFromTop, 160);
  });
  elSearch = search;
  header.append(search);

  const right = h('div', 'header-right');
  elCount = h('span', 'mono muted');
  right.append(elCount);

  elSeg = h('div', 'seg');
  for (const view of ['grid', 'list'] as const) {
    const b = h('button', 'seg-btn', cap(view));
    b.dataset['view'] = view;
    b.addEventListener('click', () => {
      state.view = view;
      render();
    });
    elSeg.append(b);
  }
  right.append(elSeg);

  const hide = h('button', 'ghost', 'Hide');
  hide.title = "Hide the library and show Instagram's own grid";
  hide.addEventListener('click', () => {
    state.visible = false;
    render();
    showRestoreChip();
  });
  right.append(hide);
  header.append(right);

  elRail = h('aside', 'rail');
  elMain = h('main', 'main');

  const body = h('div', 'body');
  body.append(elRail, elMain);
  app.append(header, body);
  return app;
}

// --- rendering --------------------------------------------------------------

function render(): void {
  if (!host || !elRail || !elMain || !elCount || !elSeg || !elSearch) return;

  host.style.display = state.visible ? 'block' : 'none';
  if (elSearch.value !== state.search) elSearch.value = state.search;
  elCount.textContent = indexLabel();
  for (const btn of elSeg.children) {
    btn.classList.toggle('on', (btn as HTMLElement).dataset['view'] === state.view);
  }

  elRail.replaceChildren(...railRows());

  // Swapping the results list resets scrollTop; put it back, so writes landing
  // mid-scroll don't throw you to the top of the grid.
  const scrollTop = resetScroll ? 0 : elMain.scrollTop;
  resetScroll = false;
  elMain.replaceChildren(...mainRows());
  elMain.scrollTop = scrollTop;
}

function railRows(): Node[] {
  const rows: Node[] = [];

  const all = h('button', `rail-row${state.selected.size === 0 ? ' on' : ''}`, [
    h('span', '', 'All saved'),
    h('span', 'mono count', String(state.stats.total)),
  ]);
  all.addEventListener('click', () => {
    state.selected.clear();
    refreshFromTop();
  });
  rows.push(all, h('div', 'divider'), h('div', 'rail-label', 'Categories'));

  let shown = 0;
  for (const name of CATEGORY_NAMES) {
    const count = state.stats.byCategory[name] ?? 0;
    if (count === 0 && !state.selected.has(name)) continue;
    rows.push(railRow(name, count));
    shown++;
  }
  if (shown === 0) rows.push(h('div', 'rail-hint', 'Categories appear here as posts are indexed.'));

  const uncat = state.stats.byCategory[UNCATEGORIZED] ?? 0;
  if (uncat > 0) rows.push(h('div', 'divider'), railRow(UNCATEGORIZED, uncat));

  if (shown > 1) {
    rows.push(h('div', 'rail-hint', `${modKeyLabel()}-click to compare two categories.`));
  }

  const foot = h('div', 'rail-foot');
  const action = h('button', 'link', primaryLabel());
  action.addEventListener('click', () => void onIndexAction());
  foot.append(action);
  rows.push(foot);

  return rows;
}

/**
 * Plain click selects exactly one category — the common case, and what a tab does.
 * ⌘/Ctrl-click builds a comparison, because occasionally you do want two at once.
 */
function railRow(name: string, count: number): HTMLElement {
  const on = state.selected.has(name);
  const row = h('button', `rail-row${on ? ' on' : ''}`, [
    h('span', '', name),
    h('span', 'mono count', String(count)),
  ]);
  row.addEventListener('click', (ev) => {
    if (ev.metaKey || ev.ctrlKey) {
      if (on) state.selected.delete(name);
      else state.selected.add(name);
    } else if (on && state.selected.size === 1) {
      state.selected.clear(); // clicking the active tab again goes back to All saved
    } else {
      state.selected.clear();
      state.selected.add(name);
    }
    refreshFromTop();
  });
  return row;
}

function mainRows(): Node[] {
  const rows: Node[] = [];

  const strays = strayNotice();
  if (strays) rows.push(strays);

  if (!state.panelDismissed) {
    const panel = indexPanel();
    if (panel) rows.push(panel);
  }

  const head = h('div', 'main-head');
  const names = [...state.selected];
  head.append(
    h('h1', 'title', names.length === 1 ? names[0]! : names.length ? 'Comparing' : 'All saved'),
    h('span', 'mono muted', countLabel()),
  );

  if (names.length > 1) {
    const chips = h('div', 'chips');
    for (const name of names) {
      const chip = h('button', 'chip', [h('span', '', name), h('span', 'x', '×')]);
      chip.title = `Remove ${name}`;
      chip.addEventListener('click', () => {
        state.selected.delete(name);
        refreshFromTop();
      });
      chips.append(chip);
    }
    const clear = h('button', 'link', 'Clear');
    clear.addEventListener('click', clearFilters);
    chips.append(clear);
    head.append(chips);
  }
  rows.push(head);

  if (state.loading) {
    rows.push(empty('Loading…', 'Reading what has been indexed so far.'));
    return rows;
  }

  const blocker = blockingState();
  if (blocker) {
    rows.push(blocker);
    return rows;
  }

  if (!state.posts.length) {
    rows.push(
      empty(
        'Nothing matches',
        'Try a shorter query, or drop a category.',
        state.search || state.selected.size
          ? { label: 'Clear filters', run: clearFilters }
          : undefined,
      ),
    );
    return rows;
  }

  const list = h('div', state.view === 'grid' ? 'grid' : 'list');
  for (const post of state.posts) list.append(card(post));
  rows.push(list);

  if (state.matches > state.posts.length) {
    const more = h('div', 'more');
    const btn = h('button', 'ghost', `Show ${Math.min(PAGE_SIZE, state.matches - state.posts.length)} more`);
    btn.addEventListener('click', () => {
      state.limit += PAGE_SIZE;
      void refresh();
    });
    more.append(btn, h('span', 'mono muted', `${state.posts.length} of ${state.matches}`));
    rows.push(more);
  }

  return rows;
}

/** `412` when it all fits, `200 / 412` when it doesn't — never a bare truncated count. */
function countLabel(): string {
  if (state.matches > state.posts.length) return `${state.posts.length} / ${state.matches}`;
  return String(state.matches);
}

/** The one full-panel state that outranks the grid, or null to show results. */
function blockingState(): HTMLElement | null {
  if (state.stats.total === 0) {
    return empty(
      'Nothing captured yet',
      'Instagram sends about a dozen posts per request, so the library fills as you scroll. ' +
        'Index now does that scrolling for you, at a human pace, until it reaches the end.',
      { label: 'Index now', run: () => void onIndexAction() },
    );
  }
  if (state.progress.phase === 'error' && state.stats.categorized === 0) {
    return empty('Indexing stopped', state.progress.message ?? 'Something went wrong.', {
      label: 'Retry',
      run: () => void onIndexAction(),
    });
  }
  return null;
}

/**
 * Shown after a sweep that reached the end of the feed and still didn't account for
 * everything in the library. Two things end up here: posts unsaved on Instagram since
 * they were captured, and posts an older build picked up off the home feed or a profile
 * grid. Removing them keeps the summaries already paid for on everything genuine.
 */
function strayNotice(): HTMLElement | null {
  if (state.strays <= 0 || state.straysDismissed) return null;

  const n = state.strays;
  const el = h('div', 'notice');
  el.append(
    h('div', 'notice-body', [
      h('div', 'notice-title', `${n} post${n === 1 ? '' : 's'} no longer in your saved feed`),
      h(
        'p',
        '',
        'A full sweep just finished and did not find ' +
          (n === 1 ? 'this one' : 'these') +
          ' — either unsaved since, or picked up from elsewhere on Instagram by an ' +
          'earlier version. Everything still saved keeps its summary.',
      ),
    ]),
  );

  const actions = h('div', 'notice-actions');
  const remove = h('button', 'pill', `Remove ${n}`);
  remove.addEventListener('click', () => void removeStrays());
  const keep = h('button', 'link', 'Keep them');
  keep.addEventListener('click', () => {
    state.straysDismissed = true;
    render();
  });
  actions.append(remove, keep);
  el.append(actions);

  return el;
}

// --- the indexing panel -----------------------------------------------------

/**
 * Indexing is two independent halves, and the difference matters because only one of
 * them costs money: *capture* is the page scrolling so Instagram loads more posts, and
 * *categorise* is the service worker sending captions to your model. The panel names both
 * and shows the money alongside the counts.
 */
function indexPanel(): HTMLElement | null {
  const p = state.progress;
  if (p.phase === 'idle' && !state.harvesting && p.pending === 0 && p.total > 0) return null;

  const el = h('div', `panel ${p.phase}`);

  const top = h('div', 'panel-top');
  top.append(h('span', 'panel-title', panelTitle()));

  const actions = h('div', 'panel-actions');
  const primary = h('button', 'pill', primaryLabel());
  primary.addEventListener('click', () => void onIndexAction());
  actions.append(primary);

  const dismiss = h('button', 'x-btn', '×');
  dismiss.title = 'Dismiss for this session — indexing continues';
  dismiss.addEventListener('click', () => {
    state.panelDismissed = true;
    render();
  });
  actions.append(dismiss);
  top.append(actions);
  el.append(top);

  const track = h('div', 'track');
  const fill = h('div', 'track-fill');
  fill.style.width = `${p.total ? (p.categorized / p.total) * 100 : 0}%`;
  track.append(fill);
  el.append(track);

  const facts = h('div', 'facts');
  facts.append(
    fact(String(p.total), 'captured'),
    fact(String(p.categorized), 'indexed'),
    fact(String(p.pending), 'queued'),
    fact(fmtUsd(p.spentUsd), 'spent'),
    fact(fmtUsd(p.estimateUsd), 'left, at most'),
  );
  el.append(facts);

  if (state.harvesting) {
    el.append(
      h('div', 'panel-note', 'Scrolling your saved posts to load more — keep this tab open.'),
    );
  }
  if (p.phase === 'error' && p.message) el.append(h('div', 'panel-note bad', p.message));

  const toggle = h('button', 'link', state.explainOpen ? 'Hide details' : 'How does this work?');
  toggle.addEventListener('click', () => {
    state.explainOpen = !state.explainOpen;
    render();
  });
  el.append(toggle);

  if (state.explainOpen) {
    el.append(
      h('div', 'explain', [
        explainRow(
          '1 · Capture — free',
          'Instagram sends about a dozen posts per request, so a post can only be captured ' +
            'once it has loaded. Scrolling captures them. Index now scrolls for you with ' +
            'randomised pauses and stops the moment Instagram rate-limits the page. No extra ' +
            'requests are ever made to Instagram.',
        ),
        explainRow(
          '2 · Categorise — the part that costs',
          'Hashtag and keyword rules label what they can for nothing. The rest go to your ' +
            'model in batches of 25 captions. Only posts with no usable caption cost a look at ' +
            'the thumbnail. Nothing is categorised twice, and a paused run resumes where it ' +
            'stopped.',
        ),
        explainRow(
          'Where it all lives',
          'Posts sit in this extension’s own IndexedDB inside your browser. Your API key is ' +
            'in extension storage that page scripts cannot read, and every model call is made ' +
            'by the background worker — never by the script running on instagram.com.',
        ),
      ]),
    );
  }

  return el;
}

function panelTitle(): string {
  const p = state.progress;
  if (p.phase === 'running') return `Indexing · ${p.categorized} of ${p.total}`;
  if (p.phase === 'error') return 'Indexing stopped';
  if (p.phase === 'paused') return `Paused · ${p.categorized} of ${p.total}`;
  if (state.harvesting) return 'Looking for more saved posts';
  if (p.pending > 0) return `${p.pending} post${p.pending === 1 ? '' : 's'} waiting to be indexed`;
  return `${p.total} post${p.total === 1 ? '' : 's'} indexed`;
}

function fact(value: string, label: string): HTMLElement {
  return h('div', 'fact', [h('span', 'mono fact-value', value), h('span', 'cap', label)]);
}

function explainRow(title: string, body: string): HTMLElement {
  return h('div', 'explain-row', [h('div', 'explain-title', title), h('p', '', body)]);
}

// --- cards ------------------------------------------------------------------

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
      ? h('div', 'summary', post.summary ?? post.caption.slice(0, 90))
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
  if (state.progress.phase === 'running' || state.harvesting) {
    stopHarvesting();
    await send({ type: 'index:pause' });
    return;
  }

  // Everything captured is already categorised, so the only useful action left is a
  // fresh pass over the lot.
  if (state.progress.phase === 'done' && state.progress.pending === 0 && state.stats.total > 0) {
    startHarvesting();
    await send({ type: 'index:reindex' });
    return;
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
  state.sweepStartedAt = Date.now();
  state.strays = 0;
  state.straysDismissed = false;
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
    // Only a sweep that reached the end of the feed has seen everything still saved, so
    // only that one can say what is missing. A stopped or throttled run has simply not
    // got there yet.
    if (result.reason === 'complete') void countStrays();
    void refresh();
  });
  render();
}

async function countStrays(): Promise<void> {
  try {
    const { count } = await send<{ count: number }>({
      type: 'posts:strays',
      since: state.sweepStartedAt,
    });
    state.strays = count;
    render();
  } catch {
    // Worker restarting. Nothing is lost — the next completed sweep asks again.
  }
}

async function removeStrays(): Promise<void> {
  try {
    await send({ type: 'posts:prune', since: state.sweepStartedAt });
  } finally {
    state.strays = 0;
    await refresh();
  }
}

function stopHarvesting(): void {
  harvest?.stop();
  harvest = null;
  state.harvesting = false;
  render();
}

function clearFilters(): void {
  state.selected.clear();
  state.search = '';
  refreshFromTop();
}

// --- small helpers ----------------------------------------------------------

function indexLabel(): string {
  const { total, categorized } = state.stats;
  if (total === 0) return 'nothing captured yet';
  if (categorized === total) return `${total} indexed`;
  return `${categorized} of ${total} indexed`;
}

function primaryLabel(): string {
  if (state.harvesting || state.progress.phase === 'running') return 'Pause';
  switch (state.progress.phase) {
    case 'paused':
    case 'error':
      return 'Resume';
    case 'done':
      return state.progress.pending > 0 ? 'Continue' : 'Re-index';
    default:
      return state.stats.total === 0 ? 'Index now' : 'Keep indexing';
  }
}

function modKeyLabel(): string {
  return navigator.userAgent.includes('Mac') ? '⌘' : 'Ctrl';
}

function fmtUsd(usd: number): string {
  if (usd <= 0) return '$0.00';
  if (usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
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

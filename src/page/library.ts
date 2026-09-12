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

import {
  send,
  subscribe,
  type Broadcast,
  type ReindexQuote,
  type SortKey,
  type Stats,
} from '../messaging';
import { startHarvest, type HarvestHandle } from '../capture/bridge';
import { isFullSavedFeed } from '../routes';
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
  sort: SortKey;
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
  /**
   * Whether the sweep in progress began on the *full* saved feed.
   *
   * Captured when the sweep starts, not read when it ends. `isFullSavedFeed()` reads the
   * current path, and walking from a collection into All posts mid-sweep never unmounts
   * the library — so a sweep of 140 recipes could finish while the path said "all posts"
   * and offer the rest of the library for deletion.
   */
  sweepWasFullFeed: boolean;
  /** Why the last refresh failed, if it did. Distinguishes broken from empty. */
  error: string | null;
  /** Post opened inside the library; Instagram itself stays one explicit action away. */
  detail: PostRecord | null;
  confirmingReindexAll: boolean;
  reindexQuote: ReindexQuote | null;
  confirmingPost: string | null;
  actionMessage: string | null;
}

const state: State = {
  posts: [],
  matches: 0,
  limit: PAGE_SIZE,
  stats: { total: 0, categorized: 0, byCategory: {}, lastRunAt: null, ledgerCount: 0 },
  progress: IDLE_PROGRESS,
  search: '',
  sort: 'saved',
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
  sweepWasFullFeed: false,
  error: null,
  detail: null,
  confirmingReindexAll: false,
  reindexQuote: null,
  confirmingPost: null,
  actionMessage: null,
};

let host: HTMLDivElement | null = null;
let shadow: ShadowRoot | null = null;
let searchDebounce = 0;
const SEARCH_DEBOUNCE_MS = 240;
/** Dropped on unmount — leaving on/off the saved route otherwise stacks up listeners. */
let unsubscribe: (() => void) | null = null;

// Persistent shell nodes — created once, mutated thereafter. Anything the user can be
// mid-interaction with belongs here: a rebuild would close an open <select>, drop the
// caret out of the search box, or lose keyboard focus.
let elApp: HTMLElement | null = null;
let elRestore: HTMLElement | null = null;
let elRail: HTMLElement | null = null;
let elMain: HTMLElement | null = null;
let elSearch: HTMLInputElement | null = null;
let elIndexLabel: HTMLElement | null = null;
let elTitle: HTMLElement | null = null;
let elCount: HTMLElement | null = null;
let elSort: HTMLSelectElement | null = null;
let elSeg: HTMLElement | null = null;
let elWhere: HTMLElement | null = null;
let elBack: HTMLButtonElement | null = null;

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

  document.addEventListener('keydown', onShortcut, true);
  setPageInert(true);
  unsubscribe = subscribe(onBroadcast);
  void refresh();
  render();
}

export function unmountLibrary(): void {
  if (harvest) void send({ type: 'harvest:finished', reason: 'stopped' }).catch(() => {});
  stopHarvesting();
  setPageInert(false);
  document.removeEventListener('keydown', onShortcut, true);
  window.clearTimeout(searchDebounce);
  window.clearTimeout(refreshQueued);
  refreshQueued = 0;

  // State is a module singleton, so anything not reset here is replayed on the next
  // mount: a remount would paint the previous visit's stale cards, ask for its 2,000-row
  // page again, and — if the user had switched to Instagram's own grid before leaving —
  // come back invisible, with a 12px chip as the only clue where the library went.
  state.posts = [];
  state.matches = 0;
  state.limit = PAGE_SIZE;
  state.loading = true;
  state.visible = true;
  state.panelDismissed = false;
  state.straysDismissed = false;
  state.strays = 0;
  state.error = null;
  state.detail = null;
  state.confirmingReindexAll = false;
  state.reindexQuote = null;
  state.confirmingPost = null;
  state.actionMessage = null;
  unsubscribe?.();
  unsubscribe = null;
  host?.remove();
  host = null;
  shadow = null;
  elApp = elRestore = elRail = elMain = elIndexLabel = null;
  elTitle = elCount = elSeg = elWhere = null;
  elBack = null;
  elSearch = null;
  elSort = null;
}

export function isLibraryMounted(): boolean {
  return host !== null;
}

/**
 * Take Instagram out of the tab order and the accessibility tree while we cover it.
 *
 * An opaque overlay hides the page visually and from nobody else: Tab walked into
 * Instagram's nav and grid links behind it, and a screen reader read both interfaces
 * interleaved as one document. `inert` is the one attribute that fixes both at once.
 */
function setPageInert(on: boolean): void {
  for (const el of document.body.children) {
    if (el === host) continue;
    (el as HTMLElement).inert = on && state.visible;
  }
}

function onBroadcast(msg: Broadcast): void {
  if (msg.type === 'posts:updated') {
    queueRefresh();
    return;
  }
  if (msg.type === 'harvest') {
    // The worker cannot scroll; only this page can. A pause from the popup has to reach
    // the harvester through here.
    if (msg.action === 'stop') stopHarvesting();
    else startHarvesting();
    return;
  }
  if (msg.type !== 'progress') return;

  if (msg.progress.phase === 'running' || msg.progress.pending > 0) {
    state.confirmingReindexAll = false;
    state.reindexQuote = null;
  }

  const moved =
    msg.progress.categorized !== state.stats.categorized ||
    msg.progress.total !== state.stats.total;

  // Scrolling having stopped is something only this page knows. A worker push carrying
  // `phase: 'running', message: null` used to overwrite it about 250ms after it appeared,
  // leaving the user waiting for a capture that was never coming.
  const stalled = !state.harvesting && state.progress.phase === 'paused' && state.progress.message;
  state.progress = stalled
    ? { ...msg.progress, phase: 'paused', message: state.progress.message }
    : msg.progress;
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

function refreshFromTop(withStats = true): void {
  resetScroll = true;
  // A new query is a new list; keeping page 3 of the old one makes no sense.
  state.limit = PAGE_SIZE;
  void refresh(withStats);
}

/**
 * Which query is current. Every refresh is fire-and-forget, and at 20,000 posts they take
 * long enough to overlap — so without this, typing "pas" then "pasta" could paint the
 * *broader* result set last, growing the grid while the search box said "pasta".
 */
let generation = 0;

/**
 * `withStats` is false on the search path. Counts do not depend on the query, and asking
 * for them on every keystroke doubled the number of full-store reads for a number that
 * had not changed.
 */
async function refresh(withStats = true): Promise<void> {
  const gen = ++generation;
  try {
    const detailShortcode = state.detail?.shortcode ?? null;
    const [result, stats, detail] = await Promise.all([
      send<{ posts: PostRecord[]; total: number }>({
        type: 'posts:query',
        search: state.search,
        categories: [...state.selected],
        limit: state.limit,
        sort: state.sort,
      }),
      withStats ? send<Stats>({ type: 'posts:stats' }) : Promise.resolve(null),
      detailShortcode
        ? send<PostRecord | null>({ type: 'post:get', shortcode: detailShortcode })
        : Promise.resolve(null),
    ]);
    if (gen !== generation) return;
    state.posts = result.posts;
    state.matches = result.total;
    if (stats) state.stats = stats;
    if (detailShortcode) state.detail = detail;
    state.error = null;
  } catch (err) {
    if (gen !== generation) return;
    // Not silence. An unreachable worker left `stats.total` at 0, which is also what an
    // empty library looks like — so a user with 18,000 indexed posts was told they had
    // none, above an "Index now" button that then did nothing.
    state.error = err instanceof Error ? err.message : String(err);
  } finally {
    if (gen === generation) {
      state.loading = false;
      render();
    }
  }
}

// --- shell ------------------------------------------------------------------

/** Built once. Everything here survives every render, so focus and caret survive too. */
function buildShell(): DocumentFragment {
  const app = h('div', 'app');
  elApp = app;

  // --- header: what is true of the whole library ---

  const header = h('header', 'header');
  header.append(
    h('div', 'brand', [h('span', 'brand-mark'), h('span', 'brand-name', 'Saved Index')]),
  );

  const search = document.createElement('input');
  search.className = 'search';
  search.type = 'search';
  search.placeholder = 'Search your saved posts';
  search.title =
    'Every word has to match, in any order. Searches the summary, caption, category, ' +
    'subcategory, tags, hashtags, handle, alt text and audio track.';
  search.addEventListener('input', () => {
    state.search = search.value;
    clearTimeout(searchDebounce);
    // 160ms was shorter than the query it was protecting, so at 20,000 posts two or three
    // were permanently in flight. Counts don't depend on the query, so this path skips
    // the stats request entirely.
    searchDebounce = self.setTimeout(() => refreshFromTop(false), SEARCH_DEBOUNCE_MS);
  });
  elSearch = search;
  header.append(search);

  const right = h('div', 'header-right');
  elIndexLabel = h('span', 'mono muted');
  elIndexLabel.setAttribute('aria-live', 'polite');
  elWhere = whereSwitch();
  right.append(elIndexLabel, elWhere);
  header.append(right);

  // --- toolbar: how *this* list is presented. Persistent, so an open <select> or a
  // focused button survives a batch of results landing underneath it. ---

  const toolbar = h('div', 'toolbar');
  elBack = h('button', 'back', '← Back');
  elBack.addEventListener('click', closeDetail);
  toolbar.append(elBack);
  elTitle = h('h1', 'title');
  elCount = h('span', 'mono muted');
  // Announced, because a search that returns nothing is otherwise completely silent.
  elCount.setAttribute('aria-live', 'polite');
  toolbar.append(elTitle, elCount);

  const sortWrap = h('label', 'sort');
  sortWrap.title =
    'Instagram does not send a save date, only the order — newest saved first. ' +
    'Save order preserves that; the other two use the post’s own publish date.';
  elSort = document.createElement('select');
  for (const key of ['saved', 'newest', 'oldest'] as const) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = SORT_LABELS[key];
    elSort.append(opt);
  }
  elSort.value = state.sort;
  elSort.addEventListener('change', () => {
    state.sort = (elSort?.value ?? 'saved') as SortKey;
    refreshFromTop();
  });
  sortWrap.append(elSort);

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
  toolbar.append(sortWrap, elSeg);

  elRail = h('aside', 'rail');
  elMain = h('main', 'main');

  const col = h('div', 'col');
  col.append(toolbar, elMain);

  const body = h('div', 'body');
  body.append(elRail, col);
  app.append(header, body);

  // The chip that brings the library back. It lives in here rather than being built on
  // demand in the page so it shares the design system, and so there is exactly one node
  // to reason about when the route changes.
  elRestore = h('button', 'restore', [
    h('span', 'brand-mark'),
    h('span', '', 'Saved Index'),
    h('span', 'mono restore-key', shortcutLabel()),
  ]);
  elRestore.title = `Show the library (${shortcutLabel()})`;
  elRestore.addEventListener('click', () => setVisible(true));

  const frag = document.createDocumentFragment();
  frag.append(app, elRestore);
  return frag;
}

/**
 * Library ↔ Instagram. A two-state switch rather than a Hide button: the library is one
 * of two ways to look at the same page, and Instagram's own grid is still underneath,
 * untouched. "Hide" read as *dismiss*, and the way back was a chip most people missed.
 */
function whereSwitch(): HTMLElement {
  const seg = h('div', 'seg seg-where');
  for (const [key, label] of [
    ['library', 'Library'],
    ['instagram', 'Instagram'],
  ] as const) {
    const b = h('button', 'seg-btn', label);
    b.dataset['where'] = key;
    b.addEventListener('click', () => setVisible(key === 'library'));
    seg.append(b);
  }
  seg.title = `Switch between the library and Instagram's own grid (${shortcutLabel()})`;
  return seg;
}

function setVisible(visible: boolean): void {
  if (state.visible === visible) return;
  state.visible = visible;
  // Hidden means Instagram is usable again — by keyboard and screen reader too, not just
  // by mouse. `setPageInert` reads `state.visible`, so this has to follow the assignment.
  setPageInert(true);
  render();
}

/**
 * Alt/Option + S. Modified so it cannot collide with Instagram's own single-key
 * shortcuts, and ignored while you are typing — on a Mac, Option+S is a real character.
 */
function onShortcut(ev: KeyboardEvent): void {
  // Escape is the first thing anyone tries on a full-viewport overlay. Getting out of the
  // way is not the same as unmounting: the chip and Alt+S bring it straight back.
  if (ev.key === 'Escape' && state.visible && host) {
    setVisible(false);
    return;
  }
  if (!ev.altKey || ev.ctrlKey || ev.metaKey) return;
  if ((ev.code || '') !== 'KeyS') return;

  // Our own search box is inside a shadow root, and `ev.target` retargets to the host
  // for anything in there. composedPath()[0] is the node actually focused.
  const target = (ev.composedPath()[0] ?? ev.target) as HTMLElement | null;
  if (target?.isContentEditable) return;
  if (target?.tagName && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

  ev.preventDefault();
  ev.stopPropagation();
  setVisible(!state.visible);
}

function shortcutLabel(): string {
  return navigator.userAgent.includes('Mac') ? '⌥S' : 'Alt+S';
}

// --- rendering --------------------------------------------------------------

function render(): void {
  if (!host || !elApp || !elRestore || !elRail || !elMain) return;
  if (!elSearch || !elIndexLabel || !elTitle || !elCount || !elSort || !elSeg || !elWhere || !elBack) return;

  // Hidden means *out of the way*, not unmounted: the host stays put so the chip and the
  // keyboard shortcut keep working, and stops intercepting pointer events so Instagram's
  // own grid underneath is fully usable.
  host.style.pointerEvents = state.visible ? 'auto' : 'none';
  elApp.style.display = state.visible ? 'flex' : 'none';
  elRestore.style.display = state.visible ? 'none' : 'flex';
  for (const btn of elWhere.children) {
    const on = ((btn as HTMLElement).dataset['where'] === 'library') === state.visible;
    btn.classList.toggle('on', on);
  }

  if (elSearch.value !== state.search) elSearch.value = state.search;
  if (elSort.value !== state.sort) elSort.value = state.sort;
  elIndexLabel.textContent = indexLabel();

  const names = [...state.selected];
  elTitle.textContent = state.detail
    ? 'Post details'
    : names.length === 1
      ? names[0]!
      : names.length
        ? 'Comparing'
        : 'All saved';
  elCount.textContent = state.detail ? '' : countLabel();
  elBack.hidden = !state.detail;
  elSort.parentElement!.style.display = state.detail ? 'none' : 'flex';
  elSeg.style.display = state.detail ? 'none' : 'flex';

  for (const btn of elSeg.children) {
    btn.classList.toggle('on', (btn as HTMLElement).dataset['view'] === state.view);
  }

  // `replaceChildren` destroys whatever had focus, and both containers hold real
  // controls — the rail rows and "Show more". Without this, activating a category threw
  // focus back to <body>, so the next Tab restarted from the top of instagram.com.
  const root = shadow;
  const focusKey = (root?.activeElement as HTMLElement | null)?.dataset['focus'] ?? null;

  elRail.replaceChildren(...railRows());

  // Swapping the results list resets scrollTop; put it back, so writes landing
  // mid-scroll don't throw you to the top of the grid.
  const scrollTop = resetScroll ? 0 : elMain.scrollTop;
  const key = listKey();
  if (resetScroll || key !== renderedListKey) {
    renderedListKey = key;
    elMain.replaceChildren(...mainRows());
    elMain.scrollTop = scrollTop;
  }
  resetScroll = false;

  if (focusKey && root) {
    root.querySelector<HTMLElement>(`[data-focus="${CSS.escape(focusKey)}"]`)?.focus();
  }
}

/**
 * Cheap identity for the rendered list.
 *
 * A run emits progress several times a second, and every one of those used to tear down
 * and rebuild every card — 1,800 elements and 200 images at the default page size, four
 * times a second, each followed by a forced layout from restoring scrollTop. Only the
 * cards whose categorisation actually flipped need a repaint.
 */
let renderedListKey = '';

function listKey(): string {
  // Include controls rendered *around* the cards as well as the cards themselves. The
  // earlier key ignored these, so Dismiss, How does this work?, a stray notice, and the
  // re-index confirmation all changed state correctly and then left identical DOM on
  // screen because the list rebuild was skipped.
  let key = [
    state.detail?.shortcode ?? '',
    state.detail?.thumbnailUrl ?? '',
    state.view,
    state.matches,
    state.search,
    state.sort,
    [...state.selected].join(','),
    state.progress.phase,
    state.harvesting,
    state.panelDismissed,
    state.explainOpen,
    state.strays,
    state.straysDismissed,
    state.confirmingReindexAll,
    state.actionMessage ?? '',
    state.error ?? '',
  ].join('|') + '|';
  for (const p of state.posts) {
    key += `${p.shortcode}:${p.category ?? ''}:${p.categorizedAt ?? 0}:${p.thumbnailUrl},`;
  }
  return key;
}

function railRows(): Node[] {
  const rows: Node[] = [];

  const all = h('button', `rail-row${state.selected.size === 0 ? ' on' : ''}`, [
    h('span', '', 'All saved'),
    h('span', 'mono count', String(state.stats.total)),
  ]);
  all.dataset['focus'] = 'rail:all';
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
  row.dataset['focus'] = `rail:${name}`;
  row.setAttribute('aria-pressed', String(on));
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

  if (state.detail) {
    rows.push(detailView(state.detail));
    return rows;
  }

  const strays = strayNotice();
  if (strays) rows.push(strays);

  if (!state.panelDismissed) {
    const panel = indexPanel();
    if (panel) rows.push(panel);
  }

  // The title, count, sort and view switch live in the persistent toolbar. Only the
  // comparison chips are conditional enough to belong with the results.
  const names = [...state.selected];
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
    rows.push(chips);
  }

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
    btn.dataset['focus'] = 'more';
    btn.addEventListener('click', () => {
      state.limit += PAGE_SIZE;
      void refresh();
    });
    more.append(btn, h('span', 'mono muted', `${state.posts.length} of ${state.matches}`));
    rows.push(more);
  }

  return rows;
}

const SORT_LABELS: Record<SortKey, string> = {
  saved: 'Save order',
  newest: 'Newest post',
  oldest: 'Oldest post',
};

/** `412` when it all fits, `200 / 412` when it doesn't — never a bare truncated count. */
function countLabel(): string {
  if (state.matches > state.posts.length) return `${state.posts.length} / ${state.matches}`;
  return String(state.matches);
}

/** The one full-panel state that outranks the grid, or null to show results. */
function blockingState(): HTMLElement | null {
  // Ahead of the empty state deliberately: an unreachable worker also reports zero posts,
  // and telling someone with a full library that they have nothing saved is worse than
  // telling them the extension is not answering.
  if (state.error) {
    return empty(
      "Can't reach the extension",
      'The background worker did not answer. This usually clears on its own; if the ' +
        'extension was just reloaded or updated, reload this tab.',
      { label: 'Try again', run: () => void refresh() },
    );
  }
  if (state.progress.phase === 'error') {
    return empty('Indexing stopped', state.progress.message ?? 'Something went wrong.', {
      label: 'Retry',
      run: () => void onIndexAction(),
    });
  }
  if (state.stats.total === 0) {
    return empty(
      'Nothing captured yet',
      'Instagram sends about a dozen posts per request, so the library fills as you scroll. ' +
        'Index now does that scrolling for you, at a human pace, until it reaches the end.',
      { label: 'Index now', run: () => void onIndexAction() },
    );
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
  const progressTotal = p.runTotal || p.total;
  const progressDone = p.runTotal ? p.runCompleted : p.categorized;
  fill.style.width = `${progressTotal ? (progressDone / progressTotal) * 100 : 0}%`;
  track.append(fill);
  el.append(track);

  const facts = h('div', 'facts');
  facts.append(
    fact(String(p.total), 'captured'),
    fact(String(p.categorized), 'indexed'),
    fact(String(Math.max(0, p.runTotal - p.runCompleted)), 'in this run'),
    fact(String(p.pending), 'waiting total'),
    fact(fmtUsd(p.spentUsd), 'spent'),
    fact(fmtUsd(p.estimateUsd), 'left, at most'),
  );
  el.append(facts);

  if (state.harvesting) {
    el.append(
      h(
        'div',
        'panel-note',
        'Scanning your saved feed — posts found after this run started wait for the next run.',
      ),
    );
  }
  if (p.phase === 'error' && p.message) el.append(h('div', 'panel-note bad', p.message));
  if (state.confirmingReindexAll && state.reindexQuote) {
    const q = state.reindexQuote;
    el.append(
      h(
        'div',
        'panel-note bad',
        q.billable === 0
          ? 'Every answer is already in the ledger, so this pass is free. Press confirm to continue.'
          : `${q.billable} of ${q.total} posts may be sent to the model again (about ${fmtUsd(q.usd)}).`,
      ),
    );
  }

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
            'the thumbnail. Each run freezes its post count when it starts, so newly found ' +
            'posts wait for the next run instead of moving the finish line.',
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
  if (p.phase === 'running') return `Indexing · ${p.runCompleted} of ${p.runTotal}`;
  if (p.phase === 'error') return 'Indexing stopped';
  if (p.phase === 'paused') return `Paused · ${p.runCompleted} of ${p.runTotal}`;
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
  el.dataset['focus'] = `post:${post.shortcode}`;
  el.title = 'View details';
  el.addEventListener('click', (ev) => {
    // Preserve the browser's expected modified-click behaviour for opening Instagram.
    if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    ev.preventDefault();
    state.detail = post;
    state.confirmingPost = null;
    state.actionMessage = null;
    resetScroll = true;
    render();
    elBack?.focus();
  });

  const thumb = mediaPreview(post, 'thumb', true);
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

  // Grid cards are tight, so only the publish date is on the face of them and the rest
  // is on hover. The list view has the room to say which date is which.
  if (state.view === 'list' && post.firstSeenAt) {
    meta.append(h('span', 'mono added', `added ${fmtDate(post.firstSeenAt)}`));
  }
  if (post.postedAt) {
    const date = h('span', 'mono date', fmtDate(post.postedAt));
    date.title = dateDetail(post);
    meta.append(date);
  }
  el.append(meta);

  return el;
}

function detailView(post: PostRecord): HTMLElement {
  const page = h('article', 'detail');
  const media = mediaPreview(post, 'detail-media', false);

  const info = h('div', 'detail-info');
  info.append(
    h('div', 'detail-heading', [chipFor(post.category), h('span', 'mono handle', post.handle)]),
    h(
      'p',
      'detail-summary',
      post.categorizedAt
        ? post.summary || 'No summary was available.'
        : 'Waiting to be indexed.',
    ),
  );

  const facts = h('dl', 'detail-facts');
  appendFact(facts, 'Subcategory', post.subcategory || '—');
  appendFact(facts, 'Tags', post.tags.length ? post.tags.join(' · ') : '—');
  appendFact(facts, 'Type', post.isVideo ? 'Video' : 'Image');
  if (post.audioTrackName) appendFact(facts, 'Audio', post.audioTrackName);
  if (post.postedAt) appendFact(facts, 'Posted', fmtLongDate(post.postedAt));
  if (post.firstSeenAt) appendFact(facts, 'Added here', fmtLongDate(post.firstSeenAt));
  appendFact(facts, 'Classified by', post.modelUsed || 'Not yet indexed');
  info.append(facts);

  if (post.caption) {
    info.append(h('div', 'detail-label', 'Caption'), h('p', 'detail-caption', post.caption));
  }

  if (state.actionMessage) {
    const status = h('div', 'detail-status', state.actionMessage);
    status.setAttribute('role', 'status');
    info.append(status);
  }

  const actions = h('div', 'detail-actions');
  const open = h('a', 'pill', 'Open on Instagram ↗');
  open.setAttribute('href', post.permalink);
  open.setAttribute('target', '_blank');
  open.setAttribute('rel', 'noopener');
  const retry = h(
    'button',
    state.confirmingPost === post.shortcode ? 'pill danger' : 'ghost',
    state.confirmingPost === post.shortcode ? 'Confirm re-index' : 'Re-index this post',
  );
  retry.addEventListener('click', () => void reindexPost(post));
  actions.append(open, retry);
  info.append(actions);

  page.append(media, info);
  return page;
}

/**
 * A media frame that fails gracefully.
 *
 * Instagram CDN URLs are signed and eventually expire. A failed `<img>` normally paints
 * its alt text at full size — the wall of captions shown in the bug report. The alt text
 * remains available on the frame for assistive technology, while the visual state is a
 * quiet, intentional placeholder until the next saved-feed scan refreshes the URL.
 */
function mediaPreview(post: PostRecord, className: string, lazy: boolean): HTMLElement {
  const frame = h('div', className);
  frame.setAttribute('role', 'img');
  frame.setAttribute('aria-label', post.altText || `Saved post by ${post.handle || 'Instagram'}`);
  frame.title = post.thumbnailUrl
    ? 'Post preview'
    : 'Preview unavailable. Scan your saved posts to refresh it.';

  frame.append(
    h('div', 'media-fallback', [
      h('span', 'media-fallback-mark'),
      h('span', 'media-fallback-label', 'Preview unavailable'),
    ]),
  );

  if (!post.thumbnailUrl) {
    frame.classList.add('media-missing');
    return frame;
  }

  const img = document.createElement('img');
  img.alt = '';
  img.decoding = 'async';
  if (lazy) img.loading = 'lazy';
  img.addEventListener('load', () => frame.classList.add('media-ready'), { once: true });
  img.addEventListener(
    'error',
    () => {
      img.remove();
      frame.classList.add('media-missing');
      frame.title = 'Instagram preview expired. Scan your saved posts to refresh it.';
    },
    { once: true },
  );
  // Set after listeners: cached failures may dispatch immediately.
  img.src = post.thumbnailUrl;
  frame.append(img);
  return frame;
}

function appendFact(list: HTMLDListElement, label: string, value: string): void {
  list.append(h('dt', '', label), h('dd', '', value));
}

function closeDetail(): void {
  const shortcode = state.detail?.shortcode ?? null;
  state.detail = null;
  state.confirmingPost = null;
  state.actionMessage = null;
  resetScroll = true;
  render();
  if (shortcode) {
    shadow
      ?.querySelector<HTMLElement>(`[data-focus="${CSS.escape(`post:${shortcode}`)}"]`)
      ?.focus();
  }
}

async function reindexPost(post: PostRecord): Promise<void> {
  if (state.confirmingPost !== post.shortcode) {
    state.confirmingPost = post.shortcode;
    state.actionMessage =
      'This will ignore the saved answer and ask the current model to classify this post again.';
    renderedListKey = '';
    return render();
  }

  state.confirmingPost = null;
  state.actionMessage = 'Queued for re-indexing…';
  renderedListKey = '';
  render();
  try {
    const result = await send<{ post: PostRecord; progress: IndexProgress }>({
      type: 'post:reindex',
      shortcode: post.shortcode,
    });
    state.detail = result.post;
    state.progress = result.progress;
    state.actionMessage =
      result.progress.phase === 'paused'
        ? 'Queued. Resume indexing when you are ready.'
        : 'Re-indexing this post now. You can keep browsing.';
    renderedListKey = '';
    queueRefresh();
  } catch (err) {
    state.actionMessage = err instanceof Error ? err.message : String(err);
    renderedListKey = '';
    render();
  }
}

/**
 * Both dates, named, plus why there isn't a third. Saying "saved 3 days ago" would be
 * inventing a number Instagram never sent.
 */
function dateDetail(post: PostRecord): string {
  const lines: string[] = [];
  if (post.postedAt) lines.push(`Posted ${fmtLongDate(post.postedAt)}`);
  lines.push(
    post.firstSeenAt
      ? `Added to this library ${fmtLongDate(post.firstSeenAt)}`
      : 'Added to this library before it started recording that',
  );
  lines.push('Instagram sends no save date — only the order, which “Save order” follows.');
  return lines.join('\n');
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

// --- actions ----------------------------------------------------------------

async function onIndexAction(): Promise<void> {
  if (state.progress.phase === 'running' || state.harvesting) {
    state.confirmingReindexAll = false;
    stopHarvesting();
    await send({ type: 'index:pause' });
    return;
  }

  if (state.progress.pending > 0) {
    state.confirmingReindexAll = false;
    state.reindexQuote = null;
  }

  // Everything captured is already categorised, so the only useful action left is a
  // fresh pass over the lot.
  if (state.progress.phase === 'done' && state.progress.pending === 0 && state.stats.total > 0) {
    if (!state.confirmingReindexAll) {
      try {
        state.reindexQuote = await send<ReindexQuote>({ type: 'index:quote' });
        state.confirmingReindexAll = true;
        render();
      } catch (err) {
        state.error = err instanceof Error ? err.message : String(err);
        render();
      }
      return;
    }
    state.confirmingReindexAll = false;
  }

  // Two halves, and they run together: the harvester scrolls the page so the capture
  // layer sees every saved post, while the worker categorises whatever has landed.
  // Only the page can scroll, so the harvester has to live here, not in the worker.
  try {
    await send({
      type:
        state.progress.phase === 'done' && state.progress.pending === 0
          ? 'index:reindex'
          : 'index:start',
    });
  } catch (err) {
    state.progress = {
      ...state.progress,
      phase: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
    render();
  }
}

let harvest: HarvestHandle | null = null;

function startHarvesting(): void {
  if (harvest) return;
  state.harvesting = true;
  state.sweepStartedAt = Date.now();
  state.sweepWasFullFeed = isFullSavedFeed();
  state.strays = 0;
  state.straysDismissed = false;
  const current = startHarvest();
  harvest = current;
  void current.done.then((result) => {
    // Pause followed quickly by Resume can leave the old sweep finishing after the new
    // one starts. Only the sweep that still owns the slot may change the visible state.
    if (harvest !== current) return;
    harvest = null;
    state.harvesting = false;
    if (result.reason === 'rate-limited') {
      state.progress = {
        ...state.progress,
        phase: 'paused',
        message: 'Instagram rate-limited the page, so scrolling stopped. Try again shortly.',
      };
    }
    // Two conditions, and both are load-bearing. The sweep must have reached the end of
    // the feed — a stopped or throttled run has simply not got there yet — and it must
    // have been sweeping the *whole* feed rather than one collection, or everything
    // outside that collection would look unsaved.
    if (result.reason === 'complete' && state.sweepWasFullFeed) void countStrays();
    void send({ type: 'harvest:finished', reason: result.reason }).catch(() => {});
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
      if (state.progress.pending > 0) return `Index ${state.progress.pending}`;
      if (state.confirmingReindexAll) return 'Confirm re-index';
      return state.reindexQuote
        ? `Re-index · ${fmtUsd(state.reindexQuote.usd)}`
        : 'Re-index';
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

/**
 * An even sweep of the hue wheel, assigned by the category's position in the taxonomy.
 *
 * The previous version hashed the name, which spread the twelve categories at random —
 * three near-identical blues, nothing in the greens, and no way to predict any of it. A
 * fixed step gives every category a distinctly different chip while keeping the whole set
 * evenly balanced. The offset just moves the first category off pure red. Chroma is set
 * in CSS and kept low: the chips should be scannable, not loud.
 */
function hueFor(name: string): number {
  const index = CATEGORY_NAMES.indexOf(name);
  if (index < 0) return 0; // Uncategorized draws with no chroma anyway
  return Math.round((index * 360) / CATEGORY_NAMES.length + 15) % 360;
}

/** Same-year dates drop the year; older ones keep it, so "12 Mar" is never ambiguous. */
function fmtDate(ms: number): string {
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

function fmtLongDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
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

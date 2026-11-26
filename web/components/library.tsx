'use client';

import type { Session } from '@supabase/supabase-js';
import { Search, Settings, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HelpMenu } from '@/components/help-menu';
import { Mark } from '@/components/logo';
import { PostCard } from '@/components/post-card';
import { PostSheet } from '@/components/post-sheet';
import { FilterChips, Sidebar } from '@/components/sidebar';
import { SettingsSheet } from '@/components/settings-sheet';
import { OrganiseMenu } from '@/components/organise-menu';
import { SortPanel, type SortPanelHandle } from '@/components/sort-panel';
import { ThemeToggle } from '@/components/theme-toggle';
import { Triage } from '@/components/triage';
import { Welcome } from '@/components/welcome';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import {
  fetchFacets,
  fetchPost,
  fetchPosts,
  knownThumbnail,
  NO_CATEGORY,
  PAGE_SIZE,
  signThumbnails,
  type Facets,
  type Post,
  type View,
} from '@/lib/library';
import { placeFrom, searchOf, type Place } from '@/lib/url-state';

/** One loaded view: what it shows and whether more pages exist. */
interface Entry {
  posts: Post[];
  pages: number;
  more: boolean;
  loading: boolean;
  error: string | null;
  /** The library changed since this loaded: shown until the fresh copy arrives, then replaced. */
  stale?: boolean;
}

function viewKey(view: View, query: string): string {
  const id = view.kind === 'category' ? view.name : view.kind === 'collection' ? view.id : '';
  return `${view.kind}:${id}|${query.trim().toLowerCase()}`;
}

function title(view: View, facets: Facets | null): string {
  switch (view.kind) {
    case 'all':
      return 'All saved';
    case 'needs-look':
      return NO_CATEGORY;
    case 'category':
      return view.name;
    case 'collection':
      return facets?.collections.find((c) => c.key === view.id)?.label ?? 'Collection';
  }
}

/** How many posts the sidebar says a view holds, when it is a plain view with no search. */
function expected(view: View, facets: Facets | null): number | null {
  if (!facets) return null;
  switch (view.kind) {
    case 'all':
      return facets.total;
    case 'needs-look':
      return facets.needsLook;
    case 'category':
      return facets.categories.find((c) => c.key === view.name)?.count ?? null;
    case 'collection':
      return facets.collections.find((c) => c.key === view.id)?.count ?? null;
  }
}

export function Library({ session }: { session: Session }) {
  // Where the user was is in the address, so a reload or a shared link lands in the same place.
  const [start] = useState<Place>(() => placeFrom(window.location.search));
  const [view, setViewState] = useState<View>(start.view);
  const [query, setQuery] = useState(start.query);
  const [debounced, setDebounced] = useState(start.query);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [facetError, setFacetError] = useState<string | null>(null);
  // Every view visited this session stays loaded, so going back to one is instant. The
  // map lives in a ref and `version` re-renders when it changes.
  const entries = useRef(new Map<string, Entry>());
  const inflight = useRef(new Map<string, AbortController>());
  const [, setVersion] = useState(0);
  const [open, setOpen] = useState<Post | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [triageOpen, setTriageOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const sortPanel = useRef<SortPanelHandle>(null);
  const userId = session.user.id;
  const key = viewKey(view, debounced);
  const current = useRef(key);
  current.current = key;

  // Bumped when the library changes underneath the cache, e.g. after organising.
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    fetchFacets().then(setFacets, (e: Error) => setFacetError(e.message));
  }, [generation]);

  // Views already loaded keep showing while they are read again, so posts that moved glide
  // out of the grid rather than the whole grid blinking to a skeleton.
  const refresh = useCallback(() => {
    for (const controller of inflight.current.values()) controller.abort();
    for (const [k, e] of entries.current) entries.current.set(k, { ...e, loading: false, stale: true });
    setGeneration((g) => g + 1);
  }, []);

  // A new account's library is empty until the extension's first sync. Look again every few
  // seconds meanwhile, so the welcome turns into the library as soon as posts arrive.
  const empty = facets?.total === 0;
  useEffect(() => {
    if (!empty) return;
    const t = setInterval(() => fetchFacets().then((f) => f.total > 0 && refresh(), () => undefined), 5_000);
    return () => clearInterval(t);
  }, [empty, refresh]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 200);
    return () => clearTimeout(t);
  }, [query]);

  // A new view starts at its top, the way a new page would.
  const setView = useCallback((v: View) => {
    setViewState(v);
    mainRef.current?.scrollTo({ top: 0 });
  }, []);

  // The post named in the address opens once it is read, even when it is not on the first page.
  useEffect(() => {
    if (!start.post) return;
    let live = true;
    fetchPost(start.post).then(
      async (p) => {
        if (!p || !live) return;
        await signThumbnails(userId, [p]);
        if (live) setOpen((o) => o ?? p);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [start.post, userId]);

  // The address follows the library. A new view is a step Back can undo; typing a search or
  // opening a post replaces the address, so Back never walks through every keystroke.
  const openShortcode = open?.shortcode ?? null;
  const shownView = useRef(viewKey(view, ''));
  useEffect(() => {
    const next = searchOf({ view, query: debounced, post: openShortcode });
    if (next === window.location.search) return;
    const viewChanged = shownView.current !== viewKey(view, '');
    shownView.current = viewKey(view, '');
    const url = `${window.location.pathname}${next}`;
    if (viewChanged) window.history.pushState(null, '', url);
    else window.history.replaceState(null, '', url);
  }, [view, debounced, openShortcode]);

  // Back and Forward put the library where the address says.
  useEffect(() => {
    function onPop() {
      const place = placeFrom(window.location.search);
      shownView.current = viewKey(place.view, '');
      setViewState(place.view);
      setQuery(place.query);
      setDebounced(place.query);
      setOpen((o) => (place.post && o?.shortcode === place.post ? o : null));
    }
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // ⌘K / Ctrl+K and "/" jump to search, the way every search-first app does.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const typing = e.target instanceof HTMLElement && e.target.closest('input, textarea, [contenteditable]');
      if (((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') || (e.key === '/' && !typing)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /**
   * Loads one page of a view into the cache. A request the user has moved away from is
   * cancelled rather than left to finish and paint over the view they are now looking at.
   */
  const load = useCallback(
    async (v: View, q: string, page: number) => {
      const k = viewKey(v, q);
      const prev = entries.current.get(k);
      if (prev?.loading) return;
      if (page === 0 && prev && !prev.error && !prev.stale) return;

      const controller = new AbortController();
      inflight.current.get(k)?.abort();
      inflight.current.set(k, controller);
      entries.current.set(k, {
        posts: prev?.posts ?? [],
        pages: prev?.pages ?? 0,
        more: prev?.more ?? false,
        loading: true,
        error: null,
        stale: prev?.stale,
      });
      setVersion((n) => n + 1);

      try {
        const rows = await fetchPosts(v, q, page, controller.signal);
        const posts = page === 0 ? rows : [...(prev?.posts ?? []), ...rows];
        // A search answers in one go, best match first; only a plain view pages.
        entries.current.set(k, { posts, pages: page + 1, more: !q.trim() && rows.length === PAGE_SIZE, loading: false, error: null });
        setVersion((n) => n + 1);
        // The grid paints from the rows straight away; thumbnails fill in as they sign.
        await signThumbnails(userId, rows);
        setVersion((n) => n + 1);
      } catch (e) {
        if (controller.signal.aborted) {
          // Cancelled: forget the half-load so a return visit starts it again.
          if (!prev) entries.current.delete(k);
          else entries.current.set(k, { ...prev, loading: false });
        } else {
          entries.current.set(k, { posts: prev?.posts ?? [], pages: prev?.pages ?? 0, more: false, loading: false, error: (e as Error).message });
        }
        setVersion((n) => n + 1);
      } finally {
        if (inflight.current.get(k) === controller) inflight.current.delete(k);
      }
    },
    [userId],
  );

  // Switching views cancels whatever else is still loading, then loads this one.
  useEffect(() => {
    for (const [k, controller] of inflight.current) if (k !== key) controller.abort();
    void load(view, debounced, 0);
  }, [key, view, debounced, load, generation]);

  // Hovering a sidebar row starts loading it, so the click usually lands on a full grid.
  const prefetch = useCallback((v: View) => void load(v, '', 0), [load]);

  const entry = entries.current.get(key);
  const posts = entry?.posts ?? [];
  const settled = entry !== undefined && !entry.loading;
  const known = debounced ? null : expected(view, facets);
  // A plain view shows the sidebar's count, not how many pages have loaded so far.
  const count = known ?? posts.length;
  const scope = debounced && view.kind !== 'all' ? title(view, facets) : null;
  const heading = debounced ? `Results for “${debounced}”` : title(view, facets);

  useEffect(() => {
    document.title = heading === 'All saved' ? 'Saved Index' : `${heading} · Saved Index`;
  }, [heading]);

  // The next page loads as the end of the grid comes into view; Show more stays as a fallback.
  const sentinel = useRef<HTMLDivElement>(null);
  const loadMore = settled && entry.more && !entry.error ? () => void load(view, debounced, entry.pages) : null;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !loadMore) return;
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && loadMore(), { root: mainRef.current, rootMargin: '800px' });
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore]);

  // The open post's neighbours in the grid, for ← and → in the panel.
  const at = open ? posts.findIndex((p) => p.shortcode === open.shortcode) : -1;
  const step = useMemo(
    () => ({
      prev: at > 0 ? () => setOpen(posts[at - 1] ?? null) : undefined,
      next: at >= 0 && at < posts.length - 1 ? () => setOpen(posts[at + 1] ?? null) : undefined,
    }),
    [at, posts],
  );

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <span className="flex w-52 items-center gap-2 text-[15px] font-semibold tracking-tight max-md:w-auto">
          <Mark />
          <span className="max-sm:hidden">Saved Index</span>
        </span>
        <label className="relative flex max-w-xl flex-1 items-center">
          <Search className="pointer-events-none absolute left-3 size-4 text-muted-foreground" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && (setQuery(''), e.currentTarget.blur())}
            placeholder="Search your saves"
            aria-label="Search your saves"
            className="h-9 w-full rounded-md border bg-muted/50 pl-9 pr-12 text-sm outline-none placeholder:text-muted-foreground focus:bg-background focus:ring-[3px] focus:ring-ring/15"
          />
          {query ? (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                searchRef.current?.focus();
              }}
              aria-label="Clear search"
              className="absolute right-1.5 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          ) : (
            <kbd className="pointer-events-none absolute right-2 rounded border bg-background px-1.5 font-mono text-[10px] text-muted-foreground max-sm:hidden">⌘K</kbd>
          )}
        </label>
        <div className="ml-auto flex items-center gap-1">
          <HelpMenu />
          <ThemeToggle />
          <Tooltip label="Settings">
            <Button variant="ghost" size="icon" onClick={() => setSettingsOpen(true)} aria-label="Settings">
              <Settings />
            </Button>
          </Tooltip>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="w-60 shrink-0 overflow-y-auto border-r bg-sidebar max-md:hidden">
          <Sidebar facets={facets} error={facetError} view={view} onView={setView} onPrefetch={prefetch} />
        </aside>

        <main ref={mainRef} className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
            {empty ? (
              <Welcome email={session.user.email ?? ''} />
            ) : (
              <>
              <FilterChips facets={facets} view={view} onView={setView} />
              <div className="mb-5 flex min-h-8 flex-wrap items-center gap-x-3 gap-y-2">
                <motion.h1 key={heading} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="text-xl font-semibold tracking-tight">
                  {heading}
                </motion.h1>
                <span className="text-[13px] tabular-nums text-muted-foreground">
                  {count.toLocaleString()} {count === 1 ? 'post' : 'posts'}
                </span>
                {scope && (
                  <span className="text-[13px] text-muted-foreground">
                    in {scope} ·{' '}
                    <button type="button" onClick={() => setView({ kind: 'all' })} className="font-medium text-foreground underline underline-offset-2">
                      Search all
                    </button>
                  </span>
                )}
                {facets && facets.total > 0 && (
                  <div className="ml-auto">
                    <OrganiseMenu facets={facets} onPick={(run) => sortPanel.current?.quote(run)} />
                  </div>
                )}
              </div>

              {/* Organising is offered wherever there is something to do, not only in Needs a category. */}
              {facets && (
                <SortPanel
                  ref={sortPanel}
                  facets={facets}
                  showUnsure={view.kind === 'needs-look'}
                  quiet={debounced !== ''}
                  onSorted={refresh}
                  onTriage={() => setTriageOpen(true)}
                />
              )}

              {entry?.error && <p className="mb-5 rounded-md border border-destructive/30 p-3 text-sm text-destructive">{entry.error}</p>}

              {settled && !entry.error && posts.length === 0 && (
                <div className="rounded-lg border border-dashed px-6 py-16 text-center">
                  <p className="font-medium">{debounced ? `Nothing matches that${scope ? ` in ${scope}` : ''}` : 'Nothing here yet'}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {debounced
                      ? scope
                        ? 'It may be in another category.'
                        : 'Try fewer or different words, or describe it another way.'
                      : 'Nothing is filed here yet.'}
                  </p>
                  {scope && (
                    <Button variant="outline" size="sm" className="mt-4" onClick={() => setView({ kind: 'all' })}>
                      Search all your saves
                    </Button>
                  )}
                </div>
              )}

              {/* Each view fades in as a whole; within it, cards glide into place when posts move out. */}
              <motion.div
                key={key}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.18 }}
                className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
              >
                <AnimatePresence initial={false} mode="popLayout">
                  {posts.map((p, i) => (
                    <motion.div
                      key={p.shortcode}
                      layout={posts.length <= 300 ? 'position' : false}
                      initial={{ opacity: 0, scale: 0.98 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.96 }}
                      transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
                    >
                      <PostCard post={p} thumb={knownThumbnail(p)} eager={i < 10} active={p.shortcode === openShortcode} onOpen={() => setOpen(p)} />
                    </motion.div>
                  ))}
                </AnimatePresence>
                {entry?.loading !== false && !entry?.stale &&
                  Array.from({ length: Math.max(0, Math.min(posts.length === 0 ? (known ?? 10) : 5, 10)) }, (_, i) => (
                    <div key={`s${i}`}>
                      <div className="aspect-[4/5] animate-pulse rounded-lg bg-muted" />
                      <div className="mt-2 h-3 w-2/3 animate-pulse rounded bg-muted" />
                    </div>
                  ))}
              </motion.div>

              <div ref={sentinel} />
              {loadMore && (
                <div className="mt-8 flex justify-center">
                  <Button variant="outline" onClick={loadMore}>
                    Show more
                  </Button>
                </div>
              )}
              </>
            )}
          </div>
        </main>
      </div>

      <Triage
        open={triageOpen}
        userId={userId}
        onOpenChange={(o) => {
          setTriageOpen(o);
          // What was filed there moved out of Needs a category.
          if (!o) refresh();
        }}
      />
      <SettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} session={session} facets={facets} onCleared={refresh} />
      <PostSheet
        post={open}
        thumb={open ? knownThumbnail(open) : undefined}
        onClose={() => setOpen(null)}
        onFixed={(post, filing) => {
          // An undo can land after the panel closed or moved on; only the post it is about changes.
          setOpen((o) => (o?.shortcode === post.shortcode ? { ...o, ...filing, categorized_at: new Date().toISOString() } : o));
          refresh();
        }}
        onIndexed={(post) => {
          setOpen((o) => (o?.shortcode === post.shortcode ? post : o));
          refresh();
        }}
        onStep={step}
      />
    </div>
  );
}

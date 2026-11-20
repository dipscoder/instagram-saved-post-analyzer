'use client';

import type { Session } from '@supabase/supabase-js';
import { Search, Settings } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Mark } from '@/components/logo';
import { PostCard } from '@/components/post-card';
import { PostSheet } from '@/components/post-sheet';
import { FilterChips, Sidebar } from '@/components/sidebar';
import { SettingsSheet } from '@/components/settings-sheet';
import { SortPanel } from '@/components/sort-panel';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import {
  fetchFacets,
  fetchPosts,
  knownThumbnail,
  PAGE_SIZE,
  signThumbnails,
  type Facets,
  type Post,
  type View,
} from '@/lib/library';

/** One loaded view: what it shows and whether more pages exist. */
interface Entry {
  posts: Post[];
  pages: number;
  more: boolean;
  loading: boolean;
  error: string | null;
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
      return 'Needs a look';
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
  const [view, setView] = useState<View>({ kind: 'all' });
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [facets, setFacets] = useState<Facets | null>(null);
  const [facetError, setFacetError] = useState<string | null>(null);
  // Every view visited this session stays loaded, so going back to one is instant. The
  // map lives in a ref and `version` re-renders when it changes.
  const entries = useRef(new Map<string, Entry>());
  const inflight = useRef(new Map<string, AbortController>());
  const [, setVersion] = useState(0);
  const [open, setOpen] = useState<Post | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const userId = session.user.id;
  const key = viewKey(view, debounced);
  const current = useRef(key);
  current.current = key;

  // Bumped when the library changes underneath the cache, e.g. after sorting.
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    fetchFacets().then(setFacets, (e: Error) => setFacetError(e.message));
  }, [generation]);

  const refresh = useCallback(() => {
    for (const controller of inflight.current.values()) controller.abort();
    entries.current.clear();
    setGeneration((g) => g + 1);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 200);
    return () => clearTimeout(t);
  }, [query]);

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
      if (page === 0 && prev && !prev.error) return;

      const controller = new AbortController();
      inflight.current.get(k)?.abort();
      inflight.current.set(k, controller);
      entries.current.set(k, {
        posts: prev?.posts ?? [],
        pages: prev?.pages ?? 0,
        more: prev?.more ?? false,
        loading: true,
        error: null,
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
  const count = settled ? posts.length : (known ?? posts.length);

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
          <kbd className="pointer-events-none absolute right-2 rounded border bg-background px-1.5 font-mono text-[10px] text-muted-foreground max-sm:hidden">⌘K</kbd>
        </label>
        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          <Button variant="ghost" size="icon" onClick={() => setSettingsOpen(true)} aria-label="Settings" title="Settings">
            <Settings />
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="w-60 shrink-0 overflow-y-auto border-r bg-sidebar max-md:hidden">
          <Sidebar facets={facets} error={facetError} view={view} onView={setView} onPrefetch={prefetch} />
        </aside>

        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
            <FilterChips facets={facets} view={view} onView={setView} />
            <div className="mb-5 flex items-baseline gap-3">
              <h1 className="text-xl font-semibold tracking-tight">{debounced ? `Results for “${debounced}”` : title(view, facets)}</h1>
              <span className="text-[13px] tabular-nums text-muted-foreground">
                {count.toLocaleString()}
                {settled && entry.more ? '+' : ''} {count === 1 ? 'post' : 'posts'}
              </span>
            </div>

            {/* Indexing is offered wherever there is something to index, not only in Needs a look. */}
            {!debounced && facets && (facets.unsorted + facets.unembedded > 0 || (view.kind === 'needs-look' && facets.needsLook > 0)) && (
              <SortPanel facets={facets} onSorted={refresh} />
            )}

            {entry?.error && <p className="mb-5 rounded-md border border-destructive/30 p-3 text-sm text-destructive">{entry.error}</p>}

            {settled && !entry.error && posts.length === 0 && (
              <div className="rounded-lg border border-dashed px-6 py-16 text-center">
                <p className="font-medium">{debounced ? 'Nothing matches that search' : 'Nothing here yet'}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {debounced
                    ? 'Try fewer or different words.'
                    : 'Open your saved posts on Instagram and press Find new posts in the Saved Index extension. Posts appear here as they sync.'}
                </p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {posts.map((p, i) => (
                <PostCard key={p.shortcode} post={p} thumb={knownThumbnail(p)} eager={i < 10} onOpen={() => setOpen(p)} />
              ))}
              {entry?.loading !== false &&
                Array.from({ length: Math.max(0, Math.min(posts.length === 0 ? (known ?? 10) : 5, 10)) }, (_, i) => (
                  <div key={`s${i}`}>
                    <div className="aspect-[4/5] animate-pulse rounded-lg bg-muted" />
                    <div className="mt-2 h-3 w-2/3 animate-pulse rounded bg-muted" />
                  </div>
                ))}
            </div>

            {settled && entry.more && (
              <div className="mt-8 flex justify-center">
                <Button variant="outline" onClick={() => void load(view, debounced, entry.pages)}>
                  Show more
                </Button>
              </div>
            )}
          </div>
        </main>
      </div>

      <SettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} session={session} facets={facets} onCleared={refresh} />
      <PostSheet post={open} thumb={open ? knownThumbnail(open) : undefined} onClose={() => setOpen(null)} />
    </div>
  );
}

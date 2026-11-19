'use client';

import type { Session } from '@supabase/supabase-js';
import { LogOut, Search } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Mark } from '@/components/logo';
import { PostCard } from '@/components/post-card';
import { PostSheet } from '@/components/post-sheet';
import { FilterChips, Sidebar } from '@/components/sidebar';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { fetchFacets, fetchPosts, PAGE_SIZE, signThumbnails, type Facets, type Post, type View } from '@/lib/library';
import { supabase } from '@/lib/supabase';

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

export function Library({ session }: { session: Session }) {
  const [view, setView] = useState<View>({ kind: 'all' });
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [facets, setFacets] = useState<Facets | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [page, setPage] = useState(0);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Post | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  // Only the newest request may write results, so a slow page can't land on a newer view.
  const latest = useRef(0);
  const userId = session.user.id;

  useEffect(() => {
    fetchFacets().then(setFacets, (e: Error) => setError(e.message));
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

  const load = useCallback(
    async (nextPage: number) => {
      const ticket = ++latest.current;
      setLoading(true);
      setError(null);
      try {
        const rows = await fetchPosts(view, debounced, nextPage);
        const signed = await signThumbnails(userId, rows);
        if (ticket !== latest.current) return;
        setPosts((prev) => (nextPage === 0 ? rows : [...prev, ...rows]));
        setThumbs((prev) => ({ ...(nextPage === 0 ? {} : prev), ...signed }));
        setPage(nextPage);
        setMore(rows.length === PAGE_SIZE);
      } catch (e) {
        if (ticket === latest.current) setError((e as Error).message);
      } finally {
        if (ticket === latest.current) setLoading(false);
      }
    },
    [view, debounced, userId],
  );

  useEffect(() => {
    void load(0);
  }, [load]);

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
            className="h-9 w-full rounded-md border bg-muted/50 pl-9 pr-12 text-sm outline-none placeholder:text-muted-foreground focus:bg-background focus:ring-[3px] focus:ring-ring/15"
          />
          <kbd className="pointer-events-none absolute right-2 rounded max-sm:hidden border bg-background px-1.5 font-mono text-[10px] text-muted-foreground">⌘K</kbd>
        </label>
        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          <Button variant="ghost" size="icon" onClick={() => void supabase.auth.signOut()} aria-label="Sign out" title={`Sign out ${session.user.email ?? ''}`}>
            <LogOut />
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="w-60 shrink-0 overflow-y-auto border-r bg-sidebar max-md:hidden">
          <Sidebar facets={facets} view={view} onView={setView} />
        </aside>

        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
            <FilterChips facets={facets} view={view} onView={setView} />
            <div className="mb-5 flex items-baseline gap-3">
              <h1 className="text-xl font-semibold tracking-tight">{debounced ? `Results for “${debounced}”` : title(view, facets)}</h1>
              {!loading && <span className="text-[13px] text-muted-foreground">{posts.length.toLocaleString()}{more ? '+' : ''} posts</span>}
            </div>

            {error && <p className="rounded-md border border-destructive/30 p-3 text-sm text-destructive">{error}</p>}

            {!error && !loading && posts.length === 0 && (
              <div className="rounded-lg border border-dashed px-6 py-16 text-center">
                <p className="font-medium">{debounced ? 'Nothing matches that search' : 'Nothing here yet'}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {debounced
                    ? 'Try fewer or different words.'
                    : 'Open a saved collection on Instagram with the extension installed, and posts appear here as they sync.'}
                </p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {posts.map((p) => (
                <PostCard key={p.shortcode} post={p} thumb={thumbs[p.shortcode]} onOpen={() => setOpen(p)} />
              ))}
              {loading &&
                Array.from({ length: posts.length === 0 ? 10 : 5 }, (_, i) => (
                  <div key={`s${i}`}>
                    <div className="aspect-[4/5] animate-pulse rounded-lg bg-muted" />
                    <div className="mt-2 h-3 w-2/3 animate-pulse rounded bg-muted" />
                  </div>
                ))}
            </div>

            {more && !loading && (
              <div className="mt-8 flex justify-center">
                <Button variant="outline" onClick={() => void load(page + 1)}>
                  Show more
                </Button>
              </div>
            )}
          </div>
        </main>
      </div>

      <PostSheet post={open} thumb={open ? thumbs[open.shortcode] : undefined} onClose={() => setOpen(null)} />
    </div>
  );
}

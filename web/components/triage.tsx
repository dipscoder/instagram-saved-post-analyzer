'use client';

import { ArrowRight, Check } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CategoryFix } from '@/components/category-fix';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { fetchUnsure, handleOf, knownThumbnail, signThumbnails, type Unsure } from '@/lib/library';

/**
 * Needs a category, one post at a time: the post, where the AI thinks it might go (keys 1, 2
 * and 3), any other category, or Skip. Each choice is free and has an Undo in its toast.
 * Posts the AI could suggest something for come first, since they take one press each.
 */
export function Triage({ open, userId, onOpenChange }: { open: boolean; userId: string; onOpenChange: (open: boolean) => void }) {
  const [queue, setQueue] = useState<Unsure[] | null>(null);
  const [at, setAt] = useState(0);
  const [filed, setFiled] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [, setSigned] = useState(0);

  useEffect(() => {
    if (!open) return;
    setQueue(null);
    setAt(0);
    setFiled(0);
    setError(null);
    fetchUnsure().then(setQueue, (e: Error) => setError(e.message));
  }, [open]);

  // Sign the next few thumbnails ahead, so each post appears with its picture.
  useEffect(() => {
    if (!queue) return;
    void signThumbnails(userId, queue.slice(at, at + 5)).then(() => setSigned((n) => n + 1));
  }, [queue, at, userId]);

  const post = queue?.[at] ?? null;
  const next = () => setAt((i) => i + 1);

  // S or → skips; 1, 2 and 3 are handled by the category buttons.
  useEffect(() => {
    if (!open || !post) return;
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target instanceof HTMLElement ? e.target : null;
      if (t?.closest('input, textarea, [role="menu"]')) return;
      if (e.key === 'ArrowRight' || e.key.toLowerCase() === 's') next();
      if (e.key === 'ArrowLeft') setAt((i) => Math.max(0, i - 1));
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, post]);

  const thumb = post ? knownThumbnail(post) : undefined;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg">
        <div className="flex-1 overflow-y-auto p-5">
          <SheetTitle className="text-base font-semibold">Needs a category</SheetTitle>
          <SheetDescription className="mt-0.5 text-[13px] text-muted-foreground">
            {queue ? `${Math.min(at + 1, queue.length).toLocaleString()} of ${queue.length.toLocaleString()} · ${filed} filed` : 'Loading…'}
          </SheetDescription>

          {error && <p className="mt-6 text-sm text-destructive">{error}</p>}

          {queue && !post && (
            <div className="mt-16 text-center">
              <Check className="mx-auto size-8" />
              <p className="mt-3 font-medium">{filed > 0 ? `Done. You filed ${filed} ${filed === 1 ? 'post' : 'posts'}.` : 'Nothing left to sort.'}</p>
              <Button className="mt-6" variant="outline" onClick={() => onOpenChange(false)}>
                Back to the library
              </Button>
            </div>
          )}

          {post && (
            <div className="mt-5">
              {thumb ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={post.shortcode} src={thumb} alt="" referrerPolicy="no-referrer" className="h-[min(38vh,20rem)] w-full rounded-lg bg-muted object-contain" />
              ) : (
                <div className="flex h-40 items-center justify-center rounded-lg bg-muted p-4 text-center text-xs text-muted-foreground">
                  {post.thumbnail_stored ? '' : 'No preview'}
                </div>
              )}
              {handleOf(post) && <p className="mt-4 text-[13px] text-muted-foreground">@{handleOf(post)}</p>}
              {post.summary && <p className="mt-1 text-sm leading-relaxed">{post.summary}</p>}
              {post.caption && <p className="mt-2 line-clamp-3 text-[13px] leading-relaxed text-muted-foreground">{post.caption}</p>}

              <div className="mt-5 flex flex-wrap items-center gap-2">
                <CategoryFix
                  key={post.shortcode}
                  post={post}
                  suggestions={post.suggestions ?? []}
                  shortcuts
                  onFixed={(filing) => {
                    // A move is filed by 'you'; an Undo from its toast puts back what the AI said,
                    // and brings that post back on screen.
                    if (filing.model_used === 'you') {
                      setFiled((n) => n + 1);
                      next();
                    } else {
                      setFiled((n) => n - 1);
                      setAt(queue!.findIndex((p) => p.shortcode === post.shortcode));
                    }
                  }}
                />
                <Button variant="ghost" size="sm" onClick={next}>
                  Skip <ArrowRight /> <kbd className="font-mono text-[10px] opacity-60">S</kbd>
                </Button>
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

'use client';

import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { CategoryFix } from '@/components/category-fix';
import { IndexPost } from '@/components/index-post';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import type { Filing } from '@/lib/corrections';
import { categoryLabel, fetchDetails, handleOf, INDEX_ERRORS, instagramUrl, profileUrl, type Post, type PostDetails } from '@/lib/library';

export function PostSheet({
  post,
  thumb,
  onClose,
  onFixed,
  onIndexed,
  onStep,
}: {
  post: Post | null;
  thumb?: string;
  onClose: () => void;
  /** The user moved the post to another category, or put it back. */
  onFixed: (post: Post, filing: Filing) => void;
  /** The post was indexed from the panel; this is how the server now holds it. */
  onIndexed: (post: Post) => void;
  /** Moves to the previous or next post in the grid; absent at either end. */
  onStep: { prev?: () => void; next?: () => void };
}) {
  // Read again after the panel indexes the post, for its transcript or why it failed.
  const [readCount, setReadCount] = useState(0);
  const details = useDetails(post, readCount);
  const transcript = details?.transcript;

  // ← and → step through the grid without closing the panel. Not while a menu is open or a
  // field has focus, where the arrows already mean something.
  useEffect(() => {
    if (!post) return;
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target instanceof HTMLElement ? e.target : null;
      if (t?.closest('input, textarea, [role="menu"]')) return;
      if (e.key === 'ArrowLeft') onStep.prev?.();
      if (e.key === 'ArrowRight') onStep.next?.();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [post, onStep]);
  return (
    <Sheet open={post !== null} onOpenChange={(open) => !open && onClose()}>
      {post && (
        <SheetContent>
          <div className="flex-1 overflow-y-auto">
            {thumb && (
              // eslint-disable-next-line @next/next/no-img-element
              // Kept short, so what the AI made of the post is in view without scrolling.
              <img src={thumb} alt="" referrerPolicy="no-referrer" className="h-[min(40vh,22rem)] w-full bg-muted object-contain" />
            )}
            <div className="space-y-5 p-5">
              <div>
                <SheetTitle className="text-base font-semibold">
                  {categoryLabel(post)}
                  {post.subcategory && <span className="font-normal text-muted-foreground"> · {post.subcategory}</span>}
                </SheetTitle>
                <SheetDescription className="mt-0.5 text-[13px] text-muted-foreground">
                  {handleOf(post) ? (
                    <a href={profileUrl(handleOf(post))} target="_blank" rel="noopener noreferrer" className="hover:text-foreground hover:underline">
                      @{handleOf(post)}
                    </a>
                  ) : (
                    'Unknown account'
                  )}
                </SheetDescription>
                {post.summary && <p className="mt-3 text-sm leading-relaxed">{post.summary}</p>}
                {post.tags.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {post.tags.map((t) => (
                      <span key={t} className="rounded-full border px-2.5 py-0.5 text-[12px] text-muted-foreground">{t}</span>
                    ))}
                  </div>
                )}
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <IndexPost
                    key={post.shortcode}
                    post={post}
                    details={details}
                    onIndexed={(fresh) => {
                      setReadCount((n) => n + 1);
                      onIndexed(fresh);
                    }}
                  />
                  <CategoryFix
                    key={`fix-${post.shortcode}`}
                    post={post}
                    onFixed={(filing) => onFixed(post, filing)}
                  />
                </div>
              </div>
              {post.categorized_at === null && details?.indexError && (
                <p className="rounded-md border px-3 py-2 text-[13px] text-muted-foreground">
                  Couldn’t organise this post. {INDEX_ERRORS[details.indexError] ?? ''}{' '}
                  {details.indexAttempts >= 3 ? 'It is left out of Organise until it changes, or you try again.' : 'Organise will try it again.'}
                </p>
              )}
              {post.audio_track_name && <p className="text-[13px] text-muted-foreground">Audio · {post.audio_track_name}</p>}
              {post.is_video && post.duration_sec ? (
                <p className="text-[13px] text-muted-foreground">Video · {Math.round(post.duration_sec)}s</p>
              ) : null}
              {post.caption && (
                <div>
                  <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/80">Caption</p>
                  <p className="whitespace-pre-line text-[13px] leading-relaxed text-muted-foreground">{post.caption}</p>
                </div>
              )}
              {transcript && (
                <div>
                  <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/80">What’s said</p>
                  <p className="text-[13px] leading-relaxed text-muted-foreground">{transcript}</p>
                </div>
              )}
            </div>
          </div>
          <div className="flex gap-2 border-t p-4">
            <Tooltip label="Previous post" shortcut="←" side="top">
              <Button variant="outline" size="icon" className="size-9" disabled={!onStep.prev} onClick={onStep.prev} aria-label="Previous post">
                <ChevronLeft />
              </Button>
            </Tooltip>
            <Button asChild className="flex-1">
              <a href={instagramUrl(post)} target="_blank" rel="noopener noreferrer">
                Open on Instagram <ExternalLink />
              </a>
            </Button>
            <Tooltip label="Next post" shortcut="→" side="top">
              <Button variant="outline" size="icon" className="size-9" disabled={!onStep.next} onClick={onStep.next} aria-label="Next post">
                <ChevronRight />
              </Button>
            </Tooltip>
          </div>
        </SheetContent>
      )}
    </Sheet>
  );
}

/** What the panel reads when it opens: a reel's transcript, or why a post was not indexed. */
function useDetails(post: Post | null, readCount: number): PostDetails | null {
  const [loaded, setLoaded] = useState<{ shortcode: string; details: PostDetails } | null>(null);
  const shortcode = post && (post.is_video || post.categorized_at === null) ? post.shortcode : null;
  useEffect(() => {
    if (!shortcode) return;
    let live = true;
    fetchDetails(shortcode).then(
      (details) => live && setLoaded({ shortcode, details }),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [shortcode, readCount]);
  return shortcode && loaded?.shortcode === shortcode ? loaded.details : null;
}

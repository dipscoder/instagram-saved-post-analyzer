'use client';

import { ExternalLink } from 'lucide-react';
import { CategoryFix } from '@/components/category-fix';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { handleOf, instagramUrl, profileUrl, type Post } from '@/lib/library';

export function PostSheet({
  post,
  thumb,
  onClose,
  onFixed,
}: {
  post: Post | null;
  thumb?: string;
  onClose: () => void;
  /** The user moved the post to another category. */
  onFixed: (post: Post, category: string | null) => void;
}) {
  return (
    <Sheet open={post !== null} onOpenChange={(open) => !open && onClose()}>
      {post && (
        <SheetContent>
          <div className="flex-1 overflow-y-auto">
            {thumb && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={thumb} alt="" referrerPolicy="no-referrer" className="aspect-[4/5] w-full bg-muted object-cover" />
            )}
            <div className="space-y-5 p-5">
              <div>
                <SheetTitle className="text-base font-semibold">
                  {post.categorized_at === null ? 'Not indexed yet' : post.category && post.category !== 'Uncategorized' ? post.category : 'Unknown'}
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
                <div className="mt-2">
                  <CategoryFix key={post.shortcode} post={post} onFixed={(category) => onFixed(post, category)} />
                </div>
              </div>
              {post.summary && <p className="text-sm leading-relaxed">{post.summary}</p>}
              {post.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {post.tags.map((t) => (
                    <span key={t} className="rounded-full border px-2.5 py-0.5 text-[12px] text-muted-foreground">{t}</span>
                  ))}
                </div>
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
            </div>
          </div>
          <div className="border-t p-4">
            <Button asChild className="w-full">
              <a href={instagramUrl(post)} target="_blank" rel="noopener noreferrer">
                Open on Instagram <ExternalLink />
              </a>
            </Button>
          </div>
        </SheetContent>
      )}
    </Sheet>
  );
}

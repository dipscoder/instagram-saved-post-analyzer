'use client';

import { Play } from 'lucide-react';
import { useState } from 'react';
import { categoryLabel, handleOf, profileUrl, type Post } from '@/lib/library';
import { cn } from '@/lib/utils';

export function PostCard({ post, thumb, eager, onOpen }: { post: Post; thumb?: string; eager?: boolean; onOpen: () => void }) {
  const unsorted = !post.category || post.category === 'Uncategorized';
  const label = categoryLabel(post);
  const handle = handleOf(post);
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="group min-w-0">
      <button onClick={onOpen} className="block w-full text-left outline-none" aria-label={`Open post by ${handle || 'unknown'}`}>
        <div className="relative aspect-[4/5] overflow-hidden rounded-lg bg-muted ring-offset-2 ring-offset-background group-has-[button:focus-visible]:ring-2 group-has-[button:focus-visible]:ring-ring">
          {thumb ? (
            // Signed storage URLs change every hour, so next/image's cache would only get in the way.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={thumb}
              alt=""
              loading={eager ? 'eager' : 'lazy'}
              fetchPriority={eager ? 'high' : 'auto'}
              decoding="async"
              referrerPolicy="no-referrer"
              onLoad={() => setLoaded(true)}
              className={cn(
                'size-full object-cover transition-[opacity,transform] duration-300 group-hover:scale-[1.02]',
                loaded ? 'opacity-100' : 'opacity-0',
              )}
            />
          ) : post.thumbnail_stored ? (
            <div className="size-full animate-pulse" />
          ) : (
            <div className="flex size-full items-center justify-center p-4 text-center text-xs text-muted-foreground">{post.caption.slice(0, 80) || 'No preview'}</div>
          )}
          {post.is_video && (
            <span className="absolute right-2 top-2 rounded-full bg-black/55 p-1 text-white backdrop-blur">
              <Play className="size-3 fill-current" />
            </span>
          )}
        </div>
      </button>
      <div className="mt-2 flex min-w-0 items-center gap-2 text-[12px]">
        <span className={cn('shrink-0', unsorted ? 'text-muted-foreground' : 'font-medium')}>{label}</span>
        {handle && (
          <a
            href={profileUrl(handle)}
            target="_blank"
            rel="noopener noreferrer"
            className="truncate text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            @{handle}
          </a>
        )}
      </div>
    </div>
  );
}

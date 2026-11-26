'use client';

import { Play } from 'lucide-react';
import { useState } from 'react';
import { emojiOf } from '@/lib/emoji';
import { categoryLabel, handleOf, profileUrl, type Post } from '@/lib/library';
import { cn } from '@/lib/utils';

export function PostCard({ post, thumb, eager, active, onOpen }: { post: Post; thumb?: string; eager?: boolean; active?: boolean; onOpen: () => void }) {
  const unsorted = !post.category || post.category === 'Uncategorized';
  const label = categoryLabel(post);
  const handle = handleOf(post);
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="group min-w-0">
      <button onClick={onOpen} className="block w-full text-left outline-none" aria-label={`Open post by ${handle || 'unknown'}`}>
        {/* The post open in the panel stays marked, so stepping with ← and → keeps your place. */}
        <div
          className={cn(
            'relative aspect-[4/5] overflow-hidden rounded-lg bg-muted ring-offset-2 ring-offset-background transition-shadow duration-200 group-has-[button:focus-visible]:ring-2 group-has-[button:focus-visible]:ring-ring',
            active && 'ring-2 ring-foreground',
          )}
        >
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
      {/* Two short lines: what it is, then who posted it, so neither crowds the other out. */}
      <div className="mt-2 min-w-0 text-[12px] leading-[18px]">
        <p className={cn('flex min-w-0 items-center gap-1', unsorted ? 'text-muted-foreground' : 'font-medium')}>
          <span aria-hidden>{post.categorized_at === null ? '⏳' : emojiOf(post.category)}</span>
          <span className="truncate">{label}</span>
          {post.also_category && (
            <span className="shrink-0 font-normal text-muted-foreground" title={`Also in ${post.also_category}`}>
              <span className="sr-only">, also in {post.also_category}</span>
              <span aria-hidden>+ {emojiOf(post.also_category)}</span>
            </span>
          )}
        </p>
        {handle && (
          <a
            href={profileUrl(handle)}
            target="_blank"
            rel="noopener noreferrer"
            className="block truncate text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            @{handle}
          </a>
        )}
      </div>
    </div>
  );
}

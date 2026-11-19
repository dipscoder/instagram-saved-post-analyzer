import { Play } from 'lucide-react';
import type { Post } from '@/lib/library';

export function PostCard({ post, thumb, onOpen }: { post: Post; thumb?: string; onOpen: () => void }) {
  const unsorted = !post.category || post.category === 'Uncategorized';
  return (
    <button onClick={onOpen} className="group text-left outline-none">
      <div className="relative aspect-[4/5] overflow-hidden rounded-lg bg-muted ring-offset-2 ring-offset-background group-focus-visible:ring-2 group-focus-visible:ring-ring">
        {thumb ? (
          // Signed storage URLs change every hour, so next/image's cache would only get in the way.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.02]" />
        ) : (
          <div className="flex size-full items-center justify-center p-4 text-center text-xs text-muted-foreground">{post.caption.slice(0, 80) || 'No preview'}</div>
        )}
        {post.is_video && (
          <span className="absolute right-2 top-2 rounded-full bg-black/55 p-1 text-white backdrop-blur">
            <Play className="size-3 fill-current" />
          </span>
        )}
      </div>
      <div className="mt-2 flex items-center gap-2 text-[12px]">
        <span className={unsorted ? 'text-muted-foreground' : 'font-medium'}>{unsorted ? 'Unknown' : post.category}</span>
        <span className="truncate text-muted-foreground">@{post.handle || 'instagram'}</span>
      </div>
    </button>
  );
}

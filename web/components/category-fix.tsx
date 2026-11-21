'use client';

import { CORRECTION_TARGETS } from '@saved-index/shared/corrections';
import { useState } from 'react';
import { correctCategory } from '@/lib/corrections';
import type { Post } from '@/lib/library';

/**
 * "Wrong category?" in the post panel: one press shows every category, a second files
 * the post there. Free, and it sticks: nothing re-files a post over the user's own fix.
 */
export function CategoryFix({ post, onFixed }: { post: Post; onFixed: (category: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const current = post.category && post.category !== 'Uncategorized' ? post.category : null;
  const label = post.categorized_at === null ? 'Choose a category' : 'Wrong category?';

  async function pick(category: string | null) {
    setSaving(category);
    setError(null);
    try {
      await correctCategory(post.shortcode, category);
      setOpen(false);
      onFixed(category);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(undefined);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[12px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      >
        {label}
      </button>
    );
  }

  return (
    <div className="rounded-md border p-3">
      <p className="mb-2 text-[12px] text-muted-foreground">Where would you look for it? Your choice sticks and helps measure accuracy.</p>
      <div className="flex flex-wrap gap-1.5">
        {CORRECTION_TARGETS.filter((c) => c !== current || post.categorized_at === null).map((c) => (
          <button
            key={c ?? 'unknown'}
            type="button"
            disabled={saving !== undefined}
            onClick={() => void pick(c)}
            className="rounded-full border px-2.5 py-0.5 text-[12px] hover:bg-muted disabled:opacity-50"
          >
            {saving === c ? 'Saving…' : (c ?? 'Unknown')}
          </button>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between">
        {error ? <p className="text-[12px] text-destructive">{error}</p> : <span />}
        <button type="button" onClick={() => setOpen(false)} className="text-[12px] text-muted-foreground hover:text-foreground">
          Cancel
        </button>
      </div>
    </div>
  );
}

'use client';

import * as Menu from '@radix-ui/react-dropdown-menu';
import { CORRECTION_TARGETS } from '@saved-index/shared/corrections';
import { Check, ChevronDown, Pencil } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { correctCategory } from '@/lib/corrections';
import type { Post } from '@/lib/library';

/**
 * Change category, in the post panel: a real button that opens every category plus
 * Unknown. Free, and it sticks: nothing re-files a post over the user's own choice. A toast
 * confirms the move and can put it back.
 */
export function CategoryFix({ post, onFixed }: { post: Post; onFixed: (category: string | null) => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const indexed = post.categorized_at !== null;
  const current = indexed && post.category && post.category !== 'Uncategorized' ? post.category : null;

  async function move(to: string | null, from: string | null, undoable: boolean) {
    setSaving(true);
    setError(null);
    try {
      await correctCategory(post.shortcode, to);
      onFixed(to);
      toast(
        to ? `Moved to ${to}` : 'Moved to Unknown',
        undoable ? { label: 'Undo', run: () => void move(from, to, false) } : undefined,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <Menu.Root>
        <Menu.Trigger asChild>
          <Button variant="outline" size="sm" disabled={saving}>
            <Pencil />
            {saving ? 'Saving…' : indexed ? 'Change category' : 'Choose a category'}
            <ChevronDown className="opacity-50" />
          </Button>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content
            align="start"
            sideOffset={6}
            className="z-[60] max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))] min-w-56 overflow-y-auto rounded-lg border bg-popover p-1 text-[13px] text-popover-foreground shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in-0"
          >
            <Menu.Label className="px-2 pb-1.5 pt-1 text-[11px] text-muted-foreground">Where would you look for it?</Menu.Label>
            {CORRECTION_TARGETS.map((c) => {
              const selected = indexed && c === current;
              return (
                <Menu.Item
                  key={c ?? 'unknown'}
                  disabled={selected}
                  onSelect={() => void move(c, current, indexed)}
                  className="flex h-8 items-center gap-2 rounded-md px-2 outline-none data-[disabled]:text-muted-foreground data-[highlighted]:bg-accent"
                >
                  <span className="flex-1">{c ?? 'Unknown'}</span>
                  {selected && <Check className="size-4" />}
                </Menu.Item>
              );
            })}
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
      {error && <p className="mt-2 text-[12px] text-destructive">{error}</p>}
    </div>
  );
}

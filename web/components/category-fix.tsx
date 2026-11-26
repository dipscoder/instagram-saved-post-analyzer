'use client';

import * as Menu from '@radix-ui/react-dropdown-menu';
import { CORRECTION_TARGETS } from '@saved-index/shared/corrections';
import { Check, ChevronDown, Pencil } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { correctCategory, undoCorrection, type Filing } from '@/lib/corrections';
import { NO_CATEGORY, type Post } from '@/lib/library';

/** Every category in the sidebar's order, then the way out. */
const TARGETS = [...CORRECTION_TARGETS.filter((c): c is string => c !== null).sort((a, b) => a.localeCompare(b)), null];

/**
 * Change category, in the post panel: a real button that opens every category plus
 * "Needs a category". Free, and it sticks: nothing re-files a post over the user's own
 * choice. A toast confirms the move, and its Undo puts the post back exactly as it was.
 */
export function CategoryFix({ post, onFixed }: { post: Post; onFixed: (filing: Filing) => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const filed = post.categorized_at !== null;
  const current = filed && post.category && post.category !== 'Uncategorized' ? post.category : null;

  async function save(work: () => Promise<void>, after: Filing, message: string, undo?: () => void) {
    setSaving(true);
    setError(null);
    try {
      await work();
      onFixed(after);
      toast(message, undo ? { label: 'Undo', run: undo } : undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function move(to: string | null) {
    const before: Filing = { category: post.category, subcategory: post.subcategory, model_used: post.model_used };
    void save(
      () => correctCategory(post.shortcode, to),
      { category: to, subcategory: null, model_used: 'you' },
      `Moved to ${to ?? NO_CATEGORY}`,
      // A post never filed has no earlier answer to go back to.
      filed ? () => void save(() => undoCorrection(post.shortcode, before), before, `Back in ${current ?? NO_CATEGORY}`) : undefined,
    );
  }

  return (
    <div>
      <Menu.Root>
        <Menu.Trigger asChild>
          <Button variant="outline" size="sm" disabled={saving}>
            <Pencil />
            {saving ? 'Saving…' : filed ? 'Change category' : 'Choose a category'}
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
            {TARGETS.map((c) => {
              const selected = filed && c === current;
              return (
                <Menu.Item
                  key={c ?? 'none'}
                  disabled={selected}
                  onSelect={() => move(c)}
                  className="flex h-8 items-center gap-2 rounded-md px-2 outline-none data-[disabled]:text-muted-foreground data-[highlighted]:bg-accent"
                >
                  <span className="flex-1">{c ?? NO_CATEGORY}</span>
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

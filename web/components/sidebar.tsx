'use client';

import { Bookmark, CircleHelp, Folder } from 'lucide-react';
import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { NO_CATEGORY, type Facets, type View } from '@/lib/library';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

function same(a: View, b: View): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'category' && b.kind === 'category') return a.name === b.name;
  if (a.kind === 'collection' && b.kind === 'collection') return a.id === b.id;
  return true;
}

function Row({ active, onClick, onHover, icon, label, count, hint }: { active: boolean; onClick: () => void; onHover?: () => void; icon?: ReactNode; label: string; count: number; hint?: string }) {
  const button = (
    <button
      onClick={onClick}
      onMouseEnter={onHover}
      onFocus={onHover}
      className={cn(
        'relative flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] transition-colors',
        active ? 'font-medium text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
      )}
    >
      {/* One highlight that slides to the chosen row. */}
      {active && <motion.span layoutId="sidebar-active" className="absolute inset-0 rounded-md bg-accent" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
      {icon && <span className="relative [&_svg]:size-4">{icon}</span>}
      <span className="relative flex-1 truncate">{label}</span>
      <span className="relative font-mono text-[11px] tabular-nums text-muted-foreground">{count.toLocaleString()}</span>
    </button>
  );
  return hint ? (
    <Tooltip label={hint} side="right">
      {button}
    </Tooltip>
  ) : (
    button
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-6">
      <p className="mb-1 px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/80">{title}</p>
      {children}
    </div>
  );
}

export function Sidebar({
  facets,
  error,
  view,
  onView,
  onPrefetch,
}: {
  facets: Facets | null;
  error: string | null;
  view: View;
  onView: (v: View) => void;
  onPrefetch: (v: View) => void;
}) {
  if (error) return <div className="p-3 text-[13px] text-destructive">Couldn’t load the sidebar: {error}</div>;
  if (!facets) {
    return (
      <div className="space-y-2 p-3">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="h-6 animate-pulse rounded bg-muted" style={{ width: `${85 - i * 6}%` }} />
        ))}
      </div>
    );
  }
  const row = (v: View, label: string, count: number, icon?: ReactNode, key?: string, hint?: string) => (
    <Row key={key} active={same(view, v)} onClick={() => onView(v)} onHover={() => onPrefetch(v)} icon={icon} label={label} count={count} hint={hint} />
  );
  return (
    <nav className="p-3">
      {row({ kind: 'all' }, 'All saved', facets.total, <Bookmark />)}
      {facets.needsLook > 0 && row({ kind: 'needs-look' }, NO_CATEGORY, facets.needsLook, <CircleHelp />, undefined, 'Not organised yet, or the AI wasn’t sure where it goes')}
      {facets.collections.length > 0 && (
        <Section title="Collections">
          {facets.collections.map((c) => row({ kind: 'collection', id: c.key }, c.label, c.count, <Folder />, c.key))}
        </Section>
      )}
      {facets.categories.length > 0 && (
        <Section title="Categories">
          {facets.categories.map((c) => row({ kind: 'category', name: c.key }, c.label, c.count, undefined, c.key))}
        </Section>
      )}
    </nav>
  );
}

/** The same choices as a scrolling row of chips, for screens too narrow for a sidebar. */
export function FilterChips({ facets, view, onView }: { facets: Facets | null; view: View; onView: (v: View) => void }) {
  if (!facets) return null;
  const items: { v: View; label: string }[] = [
    { v: { kind: 'all' }, label: 'All' },
    ...(facets.needsLook > 0 ? [{ v: { kind: 'needs-look' } as View, label: `${NO_CATEGORY} · ${facets.needsLook}` }] : []),
    ...facets.collections.map((c) => ({ v: { kind: 'collection', id: c.key } as View, label: c.label })),
    ...facets.categories.map((c) => ({ v: { kind: 'category', name: c.key } as View, label: c.label })),
  ];
  return (
    <div className="-mx-4 mb-5 flex gap-2 overflow-x-auto px-4 pb-1 md:hidden">
      {items.map(({ v, label }) => (
        <button
          key={label}
          onClick={() => onView(v)}
          className={cn(
            'h-8 shrink-0 rounded-full border px-3 text-[13px]',
            same(view, v) ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

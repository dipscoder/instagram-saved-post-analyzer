'use client';

import { Bookmark, CircleHelp, Folder } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Facets, View } from '@/lib/library';
import { cn } from '@/lib/utils';

function same(a: View, b: View): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'category' && b.kind === 'category') return a.name === b.name;
  if (a.kind === 'collection' && b.kind === 'collection') return a.id === b.id;
  return true;
}

function Row({ active, onClick, icon, label, count }: { active: boolean; onClick: () => void; icon?: ReactNode; label: string; count: number }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] transition-colors',
        active ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
      )}
    >
      {icon && <span className="[&_svg]:size-4">{icon}</span>}
      <span className="flex-1 truncate">{label}</span>
      <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{count.toLocaleString()}</span>
    </button>
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

export function Sidebar({ facets, view, onView }: { facets: Facets | null; view: View; onView: (v: View) => void }) {
  if (!facets) return <div className="p-3 text-[13px] text-muted-foreground">Loading…</div>;
  return (
    <nav className="p-3">
      <Row active={same(view, { kind: 'all' })} onClick={() => onView({ kind: 'all' })} icon={<Bookmark />} label="All saved" count={facets.total} />
      {facets.needsLook > 0 && (
        <Row active={same(view, { kind: 'needs-look' })} onClick={() => onView({ kind: 'needs-look' })} icon={<CircleHelp />} label="Needs a look" count={facets.needsLook} />
      )}
      {facets.collections.length > 0 && (
        <Section title="Collections">
          {facets.collections.map((c) => {
            const v: View = { kind: 'collection', id: c.key };
            return <Row key={c.key} active={same(view, v)} onClick={() => onView(v)} icon={<Folder />} label={c.label} count={c.count} />;
          })}
        </Section>
      )}
      {facets.categories.length > 0 && (
        <Section title="Categories">
          {facets.categories.map((c) => {
            const v: View = { kind: 'category', name: c.key };
            return <Row key={c.key} active={same(view, v)} onClick={() => onView(v)} label={c.label} count={c.count} />;
          })}
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
    ...(facets.needsLook > 0 ? [{ v: { kind: 'needs-look' } as View, label: `Needs a look · ${facets.needsLook}` }] : []),
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

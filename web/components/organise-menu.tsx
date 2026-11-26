'use client';

import * as Menu from '@radix-ui/react-dropdown-menu';
import { ChevronDown, RefreshCw, Sparkles, Workflow } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { NO_CATEGORY, type Facets } from '@/lib/library';
import type { RunKind } from '@/lib/sorting';

/**
 * Every way to organise, in one place beside the page title. Each choice only asks: the
 * panel below works out the price and waits for a second press before anything is spent.
 */
export function OrganiseMenu({ facets, onPick }: { facets: Facets; onPick: (run: RunKind) => void }) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button variant="outline" size="sm">
          <Sparkles />
          Organise
          <ChevronDown className="opacity-50" />
        </Button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          align="end"
          sideOffset={6}
          className="z-[60] w-80 rounded-lg border bg-popover p-1 text-[13px] text-popover-foreground shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
        >
          {facets.unsorted > 0 && (
            <Item icon={<Sparkles />} title={`Organise ${facets.unsorted.toLocaleString()} new`} onSelect={() => onPick('new')}>
              Posts never organised. The AI files each under a topic with a summary.
            </Item>
          )}
          {facets.needsLook > 0 && (
            <Item icon={<Sparkles />} title={`Everything in ${NO_CATEGORY}`} onSelect={() => onPick('needs')}>
              Asks the AI to read these {facets.needsLook.toLocaleString()} again and file the ones it is now sure of.
            </Item>
          )}
          <Item icon={<RefreshCw />} title={`Re-organise all ${facets.total.toLocaleString()}`} onSelect={() => onPick('everything')}>
            The AI reads every post afresh. Categories you chose yourself stay.
          </Item>
          <p className="px-3 pb-2 pt-1 text-[12px] text-muted-foreground">You see the price before anything is spent.</p>
          <Menu.Separator className="my-1 h-px bg-border" />
          <Menu.Item asChild className="flex h-9 items-center gap-2 rounded-md px-3 outline-none data-[highlighted]:bg-accent">
            <Link href="/how-it-works">
              <Workflow className="size-4" />
              How organising works
            </Link>
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

function Item({ icon, title, children, onSelect }: { icon: ReactNode; title: string; children: ReactNode; onSelect: () => void }) {
  return (
    <Menu.Item onSelect={onSelect} className="flex gap-3 rounded-md px-3 py-2 outline-none data-[highlighted]:bg-accent [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0">
      {icon}
      <span>
        <span className="block font-medium">{title}</span>
        <span className="block leading-snug text-muted-foreground">{children}</span>
      </span>
    </Menu.Item>
  );
}

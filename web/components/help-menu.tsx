'use client';

import * as Menu from '@radix-ui/react-dropdown-menu';
import { CircleHelp, Workflow } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';

/** The few things a new user asks, answered where they will look: a ? in the header. */
const ANSWERS: { title: string; body: string }[] = [
  {
    title: 'Add new saves',
    body: 'On Instagram, open your profile, then Saved, then All posts. Press Find new posts on the Saved Index bar at the bottom and keep the tab open.',
  },
  {
    title: 'Search',
    body: 'Describe what you remember in your own words, like “cafe in Ahmedabad” or “something funny”. Pick a category on the left to search only there.',
  },
  {
    title: 'Fix a category',
    body: 'Open the post and press Change category. It’s free, it sticks, and Undo puts it back.',
  },
  {
    title: 'What it costs',
    body: 'A cent or two per 100 posts, a little more for reels. The price is always shown before anything is spent.',
  },
];

export function HelpMenu() {
  return (
    <Menu.Root>
      <Tooltip label="Help">
        <Menu.Trigger asChild>
          <Button variant="ghost" size="icon" aria-label="Help">
            <CircleHelp />
          </Button>
        </Menu.Trigger>
      </Tooltip>
      <Menu.Portal>
        <Menu.Content
          align="end"
          sideOffset={6}
          className="z-[60] w-80 rounded-lg border bg-popover p-1 text-[13px] text-popover-foreground shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in-0"
        >
          {ANSWERS.map((a) => (
            <div key={a.title} className="px-3 py-2">
              <p className="font-medium">{a.title}</p>
              <p className="mt-0.5 leading-relaxed text-muted-foreground">{a.body}</p>
            </div>
          ))}
          <Menu.Separator className="my-1 h-px bg-border" />
          <Menu.Item asChild className="flex h-9 items-center gap-2 rounded-md px-3 outline-none data-[highlighted]:bg-accent">
            <Link href="/how-it-works">
              <Workflow className="size-4" />
              Under the hood: how organising works
            </Link>
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

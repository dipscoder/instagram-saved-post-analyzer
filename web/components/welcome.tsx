'use client';

import { Check, ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * What an empty library shows: three steps from nothing to a searchable library. The
 * library checks for posts every few seconds meanwhile, so the first ones arriving from the
 * extension move this along without a reload.
 */
export function Welcome({ email }: { email: string }) {
  return (
    <div className="mx-auto max-w-xl py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Make your Instagram saves searchable</h1>
      <p className="mt-2 text-sm text-muted-foreground">Three steps, a few minutes. Only the last one costs anything, and you see the price first.</p>
      <ol className="mt-8 space-y-3">
        <Step n={1} done title="Create your account">
          Signed in as {email}.
        </Step>
        <Step n={2} current title="Collect your saves">
          <p>
            Install the Saved Index extension and sign in with this account. Then on Instagram open your profile, then{' '}
            <span className="font-medium text-foreground">Saved</span>, then <span className="font-medium text-foreground">All posts</span>, and press{' '}
            <span className="font-medium text-foreground">Find new posts</span> on the bar at the bottom of the page.
          </p>
          <p className="mt-2">Keep that tab open while it scrolls: about a minute for every 500 posts.</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button size="sm" asChild>
              <a href="https://www.instagram.com/" target="_blank" rel="noopener noreferrer">
                Open Instagram <ExternalLink />
              </a>
            </Button>
            <span className="flex items-center gap-2 text-[12px]">
              <span className="size-1.5 animate-pulse rounded-full bg-foreground/60" />
              Waiting for your first posts
            </span>
          </div>
        </Step>
        <Step n={3} title="Organise them">
          The AI files each post under a topic with a short summary, so you can find it by describing it. Then search for anything you
          remember, in your own words.
        </Step>
      </ol>
    </div>
  );
}

function Step({ n, title, done, current, children }: { n: number; title: string; done?: boolean; current?: boolean; children: ReactNode }) {
  return (
    <li className={cn('flex gap-4 rounded-lg border p-4', current ? 'bg-muted/40' : 'opacity-80')}>
      <span
        className={cn(
          'flex size-6 shrink-0 items-center justify-center rounded-full border text-[12px] font-medium tabular-nums',
          done && 'border-foreground bg-foreground text-background',
        )}
      >
        {done ? <Check className="size-3.5" /> : n}
      </span>
      <div className="min-w-0 text-[13px] leading-relaxed text-muted-foreground">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <div className="mt-1">{children}</div>
      </div>
    </li>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { Facets } from '@/lib/library';
import { fetchUnsorted, quoteUsd, sortBatch, sortBatches, SortError, type Unsorted } from '@/lib/sorting';

type Phase =
  | { kind: 'idle' }
  | { kind: 'confirm'; posts: Unsorted[] }
  | { kind: 'running'; done: number; total: number }
  | { kind: 'finished'; sorted: number; unreadable: number; usd: number; stopped: string | null };

function usd(n: number): string {
  return n < 0.01 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`;
}

function posts(n: number): string {
  return `${n.toLocaleString()} post${n === 1 ? '' : 's'}`;
}

/**
 * Sorts every never-sorted post on the server. Nothing is spent until the second press:
 * the first shows the most it can cost. The run goes in small batches, newest saved
 * first, and Stop ends it after the batch in flight.
 */
export function SortPanel({ facets, onSorted }: { facets: Facets; onSorted: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const stop = useRef<AbortController | null>(null);
  const unsure = facets.needsLook - facets.unsorted;

  useEffect(() => () => stop.current?.abort(), []);

  async function quote() {
    setError(null);
    try {
      const list = await fetchUnsorted();
      if (list.length === 0) return setPhase({ kind: 'finished', sorted: 0, unreadable: 0, usd: 0, stopped: null });
      setPhase({ kind: 'confirm', posts: list });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function run(list: Unsorted[]) {
    const controller = new AbortController();
    stop.current = controller;
    const batches = sortBatches(list);
    let done = 0;
    let sorted = 0;
    let unreadable = 0;
    let spent = 0;
    let stopped: string | null = null;
    setPhase({ kind: 'running', done, total: list.length });

    for (const batch of batches) {
      if (controller.signal.aborted) {
        stopped = 'Stopped.';
        break;
      }
      try {
        const reply = await sendWithRetry(batch, controller.signal);
        sorted += reply.sorted;
        unreadable += reply.unreadable.length;
        spent += reply.usd;
      } catch (e) {
        stopped = controller.signal.aborted ? 'Stopped.' : (e as Error).message;
        break;
      }
      done += batch.length;
      setPhase({ kind: 'running', done, total: list.length });
    }
    stop.current = null;
    setPhase({ kind: 'finished', sorted, unreadable, usd: spent, stopped });
    if (sorted > 0) onSorted();
  }

  return (
    <div className="mb-6 rounded-lg border bg-muted/40 px-4 py-3 text-[13px] leading-relaxed text-muted-foreground">
      {phase.kind === 'idle' && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            {facets.unsorted > 0 && (
              <p>
                <span className="font-medium text-foreground">{posts(facets.unsorted)} not sorted yet.</span>
              </p>
            )}
            {unsure > 0 && (
              <p>
                <span className="font-medium text-foreground">{unsure.toLocaleString()} the model wasn’t sure about.</span> Rather
                than guess, it left them here for you.
              </p>
            )}
          </div>
          {facets.unsorted > 0 && (
            <Button size="sm" onClick={() => void quote()}>
              Sort {posts(facets.unsorted)}
            </Button>
          )}
        </div>
      )}

      {phase.kind === 'confirm' && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p>
            Sorting {posts(phase.posts.length)} costs at most{' '}
            <span className="font-medium text-foreground">{usd(quoteUsd(phase.posts.length))}</span>, usually much less. Posts the
            keyword rules can file cost nothing.
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setPhase({ kind: 'idle' })}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => void run(phase.posts)}>
              Sort for up to {usd(quoteUsd(phase.posts.length))}
            </Button>
          </div>
        </div>
      )}

      {phase.kind === 'running' && (
        <div>
          <div className="flex items-center justify-between gap-3">
            <p>
              <span className="font-medium text-foreground">
                Sorting {phase.done.toLocaleString()} of {posts(phase.total)}
              </span>{' '}
              · newest saved first
            </p>
            <Button size="sm" variant="outline" onClick={() => stop.current?.abort()}>
              Stop
            </Button>
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded bg-border">
            <div className="h-full bg-foreground transition-[width] duration-300" style={{ width: `${(phase.done / Math.max(1, phase.total)) * 100}%` }} />
          </div>
        </div>
      )}

      {phase.kind === 'finished' && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p>
            <span className="font-medium text-foreground">
              {phase.sorted > 0 ? `Sorted ${posts(phase.sorted)} for ${usd(phase.usd)}.` : 'Nothing was sorted.'}
            </span>
            {phase.unreadable > 0 && ` ${posts(phase.unreadable)} had no caption or picture to go on.`}
            {phase.stopped && ` ${phase.stopped}`}
          </p>
          <Button size="sm" variant="ghost" onClick={() => setPhase({ kind: 'idle' })}>
            Done
          </Button>
        </div>
      )}

      {error && <p className="mt-2 text-destructive">{error}</p>}
    </div>
  );
}

/** OpenAI rate limits are temporary: wait and try the same batch again, a few times. */
async function sendWithRetry(batch: string[], signal: AbortSignal) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await sortBatch(batch, signal);
    } catch (e) {
      if (!(e instanceof SortError) || e.status !== 429 || attempt >= 3) throw e;
      await new Promise((resolve) => setTimeout(resolve, 5_000 * (attempt + 1)));
      if (signal.aborted) throw e;
    }
  }
}

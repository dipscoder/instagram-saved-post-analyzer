'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { Facets } from '@/lib/library';
import { fetchUnsorted, isTransient, quoteUsd, retryFailed, sortBatch, sortBatches, SortError, type Unsorted } from '@/lib/sorting';

type Phase =
  | { kind: 'idle' }
  | { kind: 'confirm'; posts: Unsorted[] }
  | { kind: 'running'; done: number; total: number }
  | {
      kind: 'finished';
      sorted: number;
      embedded: number;
      transcribed: number;
      unreadable: number;
      /** Posts the server tried and could not index; recorded on each post with the reason. */
      failed: number;
      usd: number;
      stopped: string | null;
    };

function usd(n: number): string {
  return n < 0.01 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`;
}

function posts(n: number): string {
  return `${n.toLocaleString()} post${n === 1 ? '' : 's'}`;
}

/**
 * Indexes every post never indexed, on the server. Nothing is spent until the second press:
 * the first shows the most it can cost. The run goes in small batches, newest saved
 * first, and Stop ends it after the batch in flight.
 */
export function SortPanel({ facets, onSorted }: { facets: Facets; onSorted: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const stop = useRef<AbortController | null>(null);
  const unsure = facets.needsLook - facets.unsorted - facets.failed;
  // Never indexed, plus indexed before search by meaning or reel transcripts existed.
  const todo = facets.unsorted + facets.unembedded + facets.untranscribed;

  useEffect(() => () => stop.current?.abort(), []);

  async function quote() {
    setError(null);
    try {
      const list = await fetchUnsorted();
      if (list.length === 0) return setPhase({ kind: 'finished', sorted: 0, embedded: 0, transcribed: 0, unreadable: 0, failed: 0, usd: 0, stopped: null });
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
    let embedded = 0;
    let transcribed = 0;
    let unreadable = 0;
    let failed = 0;
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
        embedded += reply.embedded;
        transcribed += reply.transcribed;
        unreadable += reply.unreadable.length;
        failed += reply.failed.filter((s) => !reply.unreadable.includes(s)).length;
        spent += reply.usd;
      } catch (e) {
        if (controller.signal.aborted) {
          stopped = 'Stopped.';
          break;
        }
        // One batch the server could not finish does not end the run: its posts are counted
        // as failed and the next batch goes on. A refusal (sign in, daily limit) ends it.
        if (!isTransient(e)) {
          stopped = (e as Error).message;
          break;
        }
        failed += batch.length;
      }
      done += batch.length;
      setPhase({ kind: 'running', done, total: list.length });
    }
    stop.current = null;
    setPhase({ kind: 'finished', sorted, embedded, transcribed, unreadable, failed, usd: spent, stopped });
    // Failures are recorded on the posts too, so the counts change even when nothing was indexed.
    if (sorted > 0 || embedded > 0 || transcribed > 0 || failed > 0 || unreadable > 0) onSorted();
  }

  async function retry() {
    setError(null);
    try {
      await retryFailed();
      onSorted();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="mb-6 rounded-lg border bg-muted/40 px-4 py-3 text-[13px] leading-relaxed text-muted-foreground">
      {phase.kind === 'idle' && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            {facets.unsorted > 0 && (
              <p>
                <span className="font-medium text-foreground">{posts(facets.unsorted)} not indexed yet.</span> Indexing reads
                each post and files it under a topic with a short summary and tags, so you can find it by searching.
              </p>
            )}
            {facets.unembedded > 0 && (
              <p>
                <span className="font-medium text-foreground">{posts(facets.unembedded)} not searchable by meaning yet.</span>{' '}
                Indexing them again only adds that, for a fraction of a cent.
              </p>
            )}
            {facets.untranscribed > 0 && (
              <p>
                <span className="font-medium text-foreground">
                  {facets.untranscribed.toLocaleString()} {facets.untranscribed === 1 ? 'reel' : 'reels'} not transcribed yet.
                </span>{' '}
                Indexing writes down what is said in them, so you can search by it.
              </p>
            )}
            {facets.failed > 0 && (
              <p>
                <span className="font-medium text-foreground">{posts(facets.failed)} couldn’t be indexed</span> after three
                tries, so Index leaves them out. Open one to see why.{' '}
                <button type="button" onClick={() => void retry()} className="font-medium text-foreground underline underline-offset-2">
                  Try again
                </button>
              </p>
            )}
            {unsure > 0 && (
              <p>
                <span className="font-medium text-foreground">{unsure.toLocaleString()} the model wasn’t sure about.</span> Rather
                than guess, it left them here for you.
              </p>
            )}
          </div>
          {todo > 0 && (
            <Button size="sm" onClick={() => void quote()}>
              Index {posts(todo)}
            </Button>
          )}
        </div>
      )}

      {phase.kind === 'confirm' && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p>
            Indexing {posts(phase.posts.length)} costs at most{' '}
            <span className="font-medium text-foreground">{usd(quoteUsd(phase.posts))}</span>, usually much less. Posts the
            keyword rules can file cost nothing. Reels cost a little more: what is said in them is transcribed.
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setPhase({ kind: 'idle' })}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => void run(phase.posts)}>
              Index for up to {usd(quoteUsd(phase.posts))}
            </Button>
          </div>
        </div>
      )}

      {phase.kind === 'running' && (
        <div>
          <div className="flex items-center justify-between gap-3">
            <p>
              <span className="font-medium text-foreground">
                Indexing {phase.done.toLocaleString()} of {posts(phase.total)}
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
              {phase.sorted > 0 || phase.embedded > 0 || phase.transcribed > 0
                ? `Indexed ${posts(Math.max(phase.sorted, phase.embedded, phase.transcribed))} for ${usd(phase.usd)}.`
                : 'Nothing was indexed.'}
            </span>
            {phase.unreadable > 0 && ` ${posts(phase.unreadable)} had no caption or picture to go on.`}
            {phase.failed > 0 && ` ${posts(phase.failed)} couldn’t be indexed this time and will be tried again.`}
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

/**
 * A rate limit or a server hiccup is temporary: wait and send the same batch again. A
 * rate limit gets a few tries; any other failure one, since the server may have billed it.
 */
async function sendWithRetry(batch: string[], signal: AbortSignal) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await sortBatch(batch, signal);
    } catch (e) {
      const limited = e instanceof SortError && e.status === 429;
      if (!isTransient(e) || attempt >= (limited ? 3 : 1)) throw e;
      await new Promise((resolve) => setTimeout(resolve, 5_000 * (attempt + 1)));
      if (signal.aborted) throw e;
    }
  }
}

'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { NO_CATEGORY, type Facets } from '@/lib/library';
import {
  fetchUnsorted,
  fetchUnsuggested,
  isTransient,
  priceLabel,
  quoteUsd,
  retryFailed,
  runKind,
  sortBatch,
  sortBatches,
  SortError,
  suggestQuoteUsd,
  type RunKind,
  type Unsorted,
} from '@/lib/sorting';
import { useArmed } from '@/lib/use-armed';

type Phase =
  | { kind: 'idle' }
  | { kind: 'confirm'; run: RunKind; posts: Unsorted[] }
  | { kind: 'running'; run: RunKind; done: number; total: number }
  | {
      kind: 'finished';
      run: RunKind;
      /** Posts the run did something for: filed, made searchable or listened to. */
      done: number;
      unreadable: number;
      /** Posts the server tried and could not organise; recorded on each post with the reason. */
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

const VERB: Record<RunKind, { button: string; running: string; done: string }> = {
  new: { button: 'Organise', running: 'Organising', done: 'Organised' },
  upgrade: { button: 'Improve search for', running: 'Improving search for', done: 'Improved search for' },
  suggest: { button: 'Get suggestions for', running: 'Getting suggestions for', done: 'Got suggestions for' },
};

function priceOf(run: RunKind, list: Unsorted[]): number {
  return run === 'suggest' ? suggestQuoteUsd(list.length) : quoteUsd(list);
}

/**
 * Organises posts on the server. The main button only ever counts posts never organised;
 * bringing older posts up to date (search by meaning, a reel's words) is a separate,
 * optional offer, so the number a user is asked to pay for does not grow when nothing new
 * was saved. Nothing is spent until the second press, which shows the most it can cost
 * and cannot be hit by a double-click. A run goes in small batches, newest saved first,
 * and Stop ends it after the batch in flight.
 */
export function SortPanel({
  facets,
  showUnsure,
  onSorted,
  onTriage,
}: {
  facets: Facets;
  showUnsure: boolean;
  onSorted: () => void;
  /** Opens the one-post-at-a-time view for posts that need a category. */
  onTriage: () => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const stop = useRef<AbortController | null>(null);
  const unsure = facets.needsLook - facets.unsorted - facets.failed;
  const upgrades = facets.unembedded + facets.untranscribed;

  useEffect(() => () => stop.current?.abort(), []);

  async function quote(run: RunKind) {
    setError(null);
    try {
      const list = run === 'suggest' ? await fetchUnsuggested() : (await fetchUnsorted()).filter((p) => runKind(p) === run);
      if (list.length === 0) return setPhase({ kind: 'finished', run, done: 0, unreadable: 0, failed: 0, usd: 0, stopped: null });
      setPhase({ kind: 'confirm', run, posts: list });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function start(run: RunKind, list: Unsorted[]) {
    const controller = new AbortController();
    stop.current = controller;
    let done = 0;
    let finished = 0;
    let unreadable = 0;
    let failed = 0;
    let spent = 0;
    let stopped: string | null = null;
    setPhase({ kind: 'running', run, done, total: list.length });

    for (const batch of sortBatches(list)) {
      if (controller.signal.aborted) {
        stopped = 'Stopped.';
        break;
      }
      try {
        const reply = await sendWithRetry(batch, controller.signal, run === 'suggest');
        finished += run === 'suggest' ? reply.suggested : Math.max(reply.sorted, reply.embedded, reply.transcribed);
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
      setPhase({ kind: 'running', run, done, total: list.length });
    }
    stop.current = null;
    setPhase({ kind: 'finished', run, done: finished, unreadable, failed, usd: spent, stopped });
    // Failures are recorded on the posts too, so the counts change even when nothing was done.
    if (finished > 0 || failed > 0 || unreadable > 0) onSorted();
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
        <div className="space-y-2">
          {facets.unsorted > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p>
                <span className="font-medium text-foreground">{posts(facets.unsorted)} to organise.</span> The AI files each one under a
                topic with a short summary, so you can find it by searching.{' '}
                <Link href="/how-it-works" className="underline underline-offset-2 hover:text-foreground">
                  How it works
                </Link>
              </p>
              <Button size="sm" onClick={() => void quote('new')}>
                Organise {posts(facets.unsorted)}
              </Button>
            </div>
          )}
          {facets.failed > 0 && (
            <p>
              <span className="font-medium text-foreground">{posts(facets.failed)} couldn’t be organised.</span> Open one to see why,
              or{' '}
              <button type="button" onClick={() => void retry()} className="font-medium text-foreground underline underline-offset-2">
                try again
              </button>
              .
            </p>
          )}
          {showUnsure && unsure > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p>
                <span className="font-medium text-foreground">{posts(unsure)} need a category.</span> The AI wasn’t sure enough to file
                them, so it suggests where each might go and you choose.
              </p>
              <Button size="sm" variant="outline" onClick={onTriage}>
                Sort them one by one
              </Button>
            </div>
          )}
          {showUnsure && facets.unsuggested > 0 && (
            <p className="text-[12px]">
              {posts(facets.unsuggested)} were organised before suggestions existed.{' '}
              <button type="button" onClick={() => void quote('suggest')} className="underline underline-offset-2 hover:text-foreground">
                Get suggestions for them
              </button>
              , {priceLabel(suggestQuoteUsd(facets.unsuggested))}.
            </p>
          )}
          {upgrades > 0 && (
            <p className="text-[12px]">
              Optional:{' '}
              <button type="button" onClick={() => void quote('upgrade')} className="underline underline-offset-2 hover:text-foreground">
                improve search for {posts(upgrades)} you already have
              </button>
              , so they can be found by meaning{facets.untranscribed > 0 ? ' and by what is said in reels' : ''}.
            </p>
          )}
        </div>
      )}

      {phase.kind === 'confirm' && <Confirm phase={phase} onCancel={() => setPhase({ kind: 'idle' })} onStart={() => void start(phase.run, phase.posts)} />}

      {phase.kind === 'running' && (
        <div>
          <div className="flex items-center justify-between gap-3">
            <p>
              <span className="font-medium text-foreground">
                {VERB[phase.run].running} {phase.done.toLocaleString()} of {posts(phase.total)}
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
              {phase.done > 0 ? `${VERB[phase.run].done} ${posts(phase.done)} for ${usd(phase.usd)}.` : 'Nothing needed doing.'}
            </span>
            {phase.unreadable > 0 && ` ${posts(phase.unreadable)} had no caption or picture to go on.`}
            {phase.failed > 0 && ` ${posts(phase.failed)} couldn’t be done this time and will be tried again.`}
            {phase.stopped && ` ${phase.stopped}`}
            {phase.run === 'new' && phase.done > 0 && unsure > 0 && ` Anything the AI wasn’t sure about is in ${NO_CATEGORY}.`}
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
 * The price, and the button that spends it. The spending button sits on the left, away from
 * where the asking button was, and only arms after a moment, so a double-click never pays.
 */
function Confirm({ phase, onCancel, onStart }: { phase: Extract<Phase, { kind: 'confirm' }>; onCancel: () => void; onStart: () => void }) {
  const armed = useArmed();
  const price = usd(priceOf(phase.run, phase.posts));
  return (
    <div className="space-y-3">
      <p>
        {VERB[phase.run].running} {posts(phase.posts.length)} costs at most <span className="font-medium text-foreground">{price}</span>
        , usually much less.
        {phase.run === 'suggest'
          ? ' The AI only picks likely categories; it rewrites nothing.'
          : ' Reels cost a little more, because the AI listens to them.'}
      </p>
      <div className="flex gap-2">
        <Button size="sm" disabled={!armed} onClick={onStart}>
          {VERB[phase.run].button} {posts(phase.posts.length)} for up to {price}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * A rate limit or a server hiccup is temporary: wait and send the same batch again. A
 * rate limit gets a few tries; any other failure one, since the server may have billed it.
 */
async function sendWithRetry(batch: string[], signal: AbortSignal, suggest: boolean) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await sortBatch(batch, signal, { suggest });
    } catch (e) {
      const limited = e instanceof SortError && e.status === 429;
      if (!isTransient(e) || attempt >= (limited ? 3 : 1)) throw e;
      await new Promise((resolve) => setTimeout(resolve, 5_000 * (attempt + 1)));
      if (signal.aborted) throw e;
    }
  }
}

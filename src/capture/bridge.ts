/**
 * ISOLATED world. Receives payloads from the MAIN-world patch, turns them into records,
 * and forwards them to the service worker.
 *
 * Also owns the active harvester ("Index now"), which auto-scrolls the saved grid with
 * randomised delays and stops the moment Instagram returns a 429.
 */

import { extractPosts } from './extract';
import { scrapeSavedGrid } from './dom-scrape';
import { isSavedRoute } from '../routes';
import { WIRE, send, type BridgeMessage, type MainWorldMessage } from '../messaging';
import type { CapturedPost } from '../types';

const SCROLL_MIN_MS = 800;
const SCROLL_MAX_MS = 2000;
/** Give up after this many scrolls that surface nothing new — we've hit the end. */
const IDLE_ROUNDS_BEFORE_STOP = 3;

let rateLimited = false;
const seen = new Set<string>();

export function startBridge(): void {
  window.addEventListener('message', handleMessage);

  // Tell the MAIN world we're listening so it can flush anything captured before this
  // script ran. Both scripts are document_start; their relative order isn't guaranteed.
  const ready: BridgeMessage = { wire: WIRE, kind: 'bridge-ready' };
  window.postMessage(ready, window.location.origin);

  // Cover the case where the grid painted from memory with no network call at all.
  setTimeout(() => void ingest(scrapeSavedGrid()), 1500);
}

function handleMessage(ev: MessageEvent): void {
  if (ev.source !== window) return;
  const msg = ev.data as MainWorldMessage | null;
  if (msg?.wire !== WIRE) return;

  if (msg.kind === 'rate-limited') {
    rateLimited = true;
    return;
  }
  if (msg.kind !== 'captured') return;

  // The outermost fence. A saved-feed response can only be an answer to the saved grid
  // being on screen; anything arriving while you are on the home feed, a profile, or an
  // open post is about content you were shown, not content you saved.
  if (!isSavedRoute()) return;

  const posts: CapturedPost[] = [];
  for (const payload of msg.payloads) {
    posts.push(...extractPosts(payload.json, payload.trusted ? 'any' : 'saved'));
  }
  void ingest(posts);
}

async function ingest(posts: CapturedPost[]): Promise<void> {
  // Dedupe in-page as well as in the DB — this saves a round trip on every re-render of
  // an already-seen tile, which on an infinite scroll is most of them.
  const fresh = posts.filter((p) => p.shortcode && !seen.has(p.shortcode));
  if (!fresh.length) return;
  for (const p of fresh) seen.add(p.shortcode);

  try {
    await send({ type: 'posts:captured', posts: fresh });
  } catch {
    // Service worker asleep or extension reloading; the tile will come round again.
    for (const p of fresh) seen.delete(p.shortcode);
  }
}

// --- active harvest ---------------------------------------------------------

export interface HarvestHandle {
  stop(): void;
  readonly done: Promise<HarvestResult>;
}

export type HarvestResult = { reason: 'complete' | 'stopped' | 'rate-limited'; found: number };

/**
 * Scroll the page to the bottom, pausing a randomised 800–2000 ms between steps.
 * Randomised rather than fixed because a metronomic scroll cadence is itself a signal.
 */
export function startHarvest(): HarvestHandle {
  let stopped = false;

  // A sweep is also a census: every post still in the feed gets re-confirmed, which is
  // what lets the worker tell a genuine save from a stray afterwards. The in-page dedupe
  // would hide posts already seen this page-session from that count, so it starts empty.
  seen.clear();
  const before = 0;

  const done = (async (): Promise<HarvestResult> => {
    let idleRounds = 0;

    while (!stopped) {
      if (rateLimited) return { reason: 'rate-limited', found: seen.size - before };

      const heightBefore = document.documentElement.scrollHeight;
      const countBefore = seen.size;

      window.scrollTo({ top: heightBefore, behavior: 'smooth' });
      await sleep(SCROLL_MIN_MS + Math.random() * (SCROLL_MAX_MS - SCROLL_MIN_MS));

      // Pick up any tiles that rendered without a network call.
      void ingest(scrapeSavedGrid());

      const grew = document.documentElement.scrollHeight > heightBefore;
      const foundMore = seen.size > countBefore;
      idleRounds = grew || foundMore ? 0 : idleRounds + 1;

      if (idleRounds >= IDLE_ROUNDS_BEFORE_STOP) {
        return { reason: 'complete', found: seen.size - before };
      }
    }

    return { reason: 'stopped', found: seen.size - before };
  })();

  return {
    stop() {
      stopped = true;
    },
    done,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Typed contracts for the three hops:
 *   MAIN world  --window.postMessage-->  ISOLATED  --chrome.runtime-->  service worker
 */

import type { LedgerFile } from './background/ledger';
import type { CapturedPost, IndexProgress, PostRecord, Settings } from './types';

export type { LedgerFile };

/** Namespace tag on window.postMessage traffic — instagram.com posts plenty of its own. */
export const WIRE = 'saved-index';

/**
 * Long-lived port name for service-worker → UI pushes. Ports rather than
 * `chrome.tabs.sendMessage` so we never need the `tabs` permission.
 */
export const PORT = 'saved-index-events';

/**
 * One intercepted response body, plus whether its URL alone proved it was the saved feed.
 * An untrusted payload is read only inside its saved-feed subtree — see capture/extract.
 */
export interface CapturedPayload {
  json: unknown;
  trusted: boolean;
}

export type MainWorldMessage =
  | { wire: typeof WIRE; kind: 'captured'; payloads: CapturedPayload[] }
  | { wire: typeof WIRE; kind: 'main-ready' }
  /** Instagram answered an API call with 429. Only the MAIN world can see this. */
  | { wire: typeof WIRE; kind: 'rate-limited' };

export type BridgeMessage = { wire: typeof WIRE; kind: 'bridge-ready' };

/**
 * `saved` is the order Instagram lists them in, newest-saved first — the closest thing to
 * a save date that exists. The other two are the post's own timestamp.
 */
export type SortKey = 'saved' | 'newest' | 'oldest';

/** content script / popup → service worker */
export type Request =
  /** `pageId` identifies the visit, which is what makes feed order into save order. */
  | { type: 'posts:captured'; posts: CapturedPost[]; pageId: string }
  | {
      type: 'posts:query';
      search: string;
      categories: string[];
      limit: number;
      sort: SortKey;
    }
  | { type: 'posts:stats' }
  | { type: 'post:get'; shortcode: string }
  /** How many records a sweep started at `since` did not re-confirm. */
  | { type: 'posts:strays'; since: number }
  | { type: 'posts:prune'; since: number }
  | { type: 'post:reindex'; shortcode: string }
  | { type: 'index:start' }
  | { type: 'index:pause' }
  | { type: 'index:reindex' }
  /** What a re-index would actually cost, given what the ledger already holds. */
  | { type: 'index:quote' }
  | { type: 'ledger:export' }
  | { type: 'ledger:import'; file: unknown }
  | { type: 'index:progress' }
  /** The page owns scrolling and reports when a requested sweep naturally ends. */
  | { type: 'harvest:finished'; reason: 'complete' | 'stopped' | 'rate-limited' }
  | { type: 'spend:reset' }
  | { type: 'settings:get' }
  | { type: 'settings:set'; patch: Partial<Settings> }
  | { type: 'settings:clear-key' }
  | { type: 'settings:test-key' }
  /** Test before persistence so an invalid replacement never becomes the active key. */
  | { type: 'settings:test-candidate'; provider: Settings['provider']; model: string; apiKey: string }
  /** Account requests are accepted from extension pages only, never a content script. */
  | { type: 'account:get' }
  | { type: 'account:sign-in'; email: string; password: string }
  | { type: 'account:sign-up'; email: string; password: string }
  | { type: 'account:sign-out' }
  | { type: 'account:sync' };

export type Response =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

/** The honest price of a re-index: only the posts the ledger cannot answer for. */
export interface ReindexQuote {
  total: number;
  billable: number;
  usd: number;
}

export interface Stats {
  total: number;
  categorized: number;
  byCategory: Record<string, number>;
  lastRunAt: number | null;
  /** Verdicts on file — the work that survives a prune, a re-index or a reinstall. */
  ledgerCount: number;
}

/**
 * service worker → content script / popup (broadcast)
 *
 * `harvest` is a command rather than a notification: only the page can scroll, so when
 * indexing is paused or started from the popup the worker has to ask the content script
 * to stop or start auto-scrolling on its behalf.
 */
export type Broadcast =
  | { type: 'progress'; progress: IndexProgress }
  | { type: 'harvest'; action: 'start' | 'stop' }
  /** Captured metadata changed without changing library counts (for example a fresh CDN URL). */
  | { type: 'posts:updated' }
  | { type: 'settings'; settings: SafeSettings };

/** The account as it may leave the service worker: who is signed in, never their tokens. */
export interface AccountState {
  email: string | null;
  lastSyncAt: number | null;
  /** Posts currently mirrored to the account. */
  synced: number;
  error: string | null;
  /** Set after sign-up when the project requires email confirmation first. */
  confirmEmail?: boolean;
}

/** Settings as they may safely leave the service worker — key replaced by a mask. */
export type SafeSettings = Omit<Settings, 'apiKey'> & {
  keyMask: string;
  hasKey: boolean;
};

export async function send<T = unknown>(req: Request): Promise<T> {
  const res: Response | undefined = await chrome.runtime.sendMessage(req);
  if (!res) throw new Error('No response from the extension service worker.');
  if (!res.ok) throw new Error(res.error);
  return res.value as T;
}

/** Subscribe to service-worker pushes. Returns an unsubscribe function. */
export function subscribe(onEvent: (msg: Broadcast) => void): () => void {
  let port: chrome.runtime.Port | null = null;
  let closed = false;

  const connect = (): void => {
    if (closed) return;
    try {
      port = chrome.runtime.connect({ name: PORT });
    } catch {
      // "Extension context invalidated" — this content script outlived its extension
      // after a reload or an update. Throwing here escaped into the retry timer and
      // killed the retry with it, leaving a mounted library permanently deaf.
      closed = true;
      return;
    }
    port.onMessage.addListener((msg) => onEvent(msg as Broadcast));
    // MV3 idles the worker out from under us roughly every 5 minutes; reconnect so
    // the UI keeps receiving progress instead of silently going stale.
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      port = null;
      if (!closed) setTimeout(connect, 1000);
    });
  };

  connect();
  return () => {
    closed = true;
    port?.disconnect();
  };
}

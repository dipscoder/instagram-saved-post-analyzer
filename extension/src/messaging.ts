/**
 * Typed contracts for the three hops:
 *   MAIN world  --window.postMessage-->  ISOLATED  --chrome.runtime-->  service worker
 */

import type { CapturedPost, Settings } from './types';

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

/** content script / popup → service worker */
export type Request =
  /** `pageId` identifies the visit, which is what makes feed order into save order. */
  | {
      type: 'posts:captured';
      posts: CapturedPost[];
      pageId: string;
      /** The user's own collection on screen, if any. Page-influenced: validated in the worker. */
      collection?: SavedCollectionRef | null;
    }
  /** How many posts this browser has found. */
  | { type: 'posts:count' }
  /** How many records a sweep started at `since` did not re-confirm. */
  | { type: 'posts:strays'; since: number }
  | { type: 'posts:prune'; since: number }
  /** Scroll the open collection to find posts. Free: Instagram loads them either way. */
  | { type: 'find:start' }
  | { type: 'find:stop' }
  /** The page owns scrolling and reports when a requested sweep naturally ends. */
  | { type: 'harvest:finished'; reason: 'complete' | 'stopped' | 'rate-limited' }
  /** Where the popup's Find goes when no saved feed is open: the one last seen capturing. */
  | { type: 'library:url' }
  | { type: 'settings:get' }
  | { type: 'theme:set'; theme: Settings['theme'] }
  /** Account requests are accepted from extension pages only, never a content script. */
  | { type: 'account:get' }
  | { type: 'account:sign-in'; email: string; password: string }
  | { type: 'account:sign-up'; email: string; password: string }
  | { type: 'account:sign-out' }
  | { type: 'account:sync' };

export type Response =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

/** One of the user's own Instagram collections: numeric id and the name from its URL. */
export interface SavedCollectionRef {
  id: string;
  name: string;
}

/**
 * service worker → content script / popup (broadcast)
 *
 * `harvest` is a command rather than a notification: only the page can scroll, so when
 * finding is started or stopped from the popup the worker has to ask the content script
 * to do it on its behalf.
 */
export type Broadcast =
  /** How many posts this browser has found, pushed as capture adds to it. */
  | { type: 'found'; total: number }
  | { type: 'harvest'; action: 'start' | 'stop' }
  | { type: 'settings'; settings: Settings };

/** The account as it may leave the service worker: who is signed in, never their tokens. */
export interface AccountState {
  email: string | null;
  lastSyncAt: number | null;
  /** Posts currently mirrored to the account. */
  synced: number;
  /** Of those, how many have their thumbnail stored. */
  thumbnails: number;
  error: string | null;
  /** Set after sign-up when the project requires email confirmation first. */
  confirmEmail?: boolean;
}

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

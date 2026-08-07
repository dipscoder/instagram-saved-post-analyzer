/**
 * Typed contracts for the three hops:
 *   MAIN world  --window.postMessage-->  ISOLATED  --chrome.runtime-->  service worker
 */

import type { CapturedPost, IndexProgress, PostRecord, Settings } from './types';

/** Namespace tag on window.postMessage traffic — instagram.com posts plenty of its own. */
export const WIRE = 'saved-index';

/**
 * Long-lived port name for service-worker → UI pushes. Ports rather than
 * `chrome.tabs.sendMessage` so we never need the `tabs` permission.
 */
export const PORT = 'saved-index-events';

export type MainWorldMessage =
  | { wire: typeof WIRE; kind: 'captured'; payloads: unknown[] }
  | { wire: typeof WIRE; kind: 'main-ready' }
  /** Instagram answered an API call with 429. Only the MAIN world can see this. */
  | { wire: typeof WIRE; kind: 'rate-limited' };

export type BridgeMessage = { wire: typeof WIRE; kind: 'bridge-ready' };

/** content script / popup → service worker */
export type Request =
  | { type: 'posts:captured'; posts: CapturedPost[] }
  | { type: 'posts:query'; search: string; categories: string[]; limit: number }
  | { type: 'posts:stats' }
  | { type: 'index:start' }
  | { type: 'index:pause' }
  | { type: 'index:reindex' }
  | { type: 'index:progress' }
  | { type: 'settings:get' }
  | { type: 'settings:set'; patch: Partial<Settings> }
  | { type: 'settings:test-key' };

export type Response =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

export interface Stats {
  total: number;
  categorized: number;
  byCategory: Record<string, number>;
  lastRunAt: number | null;
}

/** service worker → content script / popup (broadcast) */
export type Broadcast =
  | { type: 'progress'; progress: IndexProgress }
  | { type: 'posts:updated'; posts: PostRecord[] };

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
    port = chrome.runtime.connect({ name: PORT });
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

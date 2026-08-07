/**
 * Typed contracts for the three hops:
 *   MAIN world  --window.postMessage-->  ISOLATED  --chrome.runtime-->  service worker
 */

import type { CapturedPost, IndexProgress, PostRecord, Settings } from './types';

/** Namespace tag on window.postMessage traffic — instagram.com posts plenty of its own. */
export const WIRE = 'saved-index';

export type MainWorldMessage =
  | { wire: typeof WIRE; kind: 'captured'; payloads: unknown[] }
  | { wire: typeof WIRE; kind: 'main-ready' };

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

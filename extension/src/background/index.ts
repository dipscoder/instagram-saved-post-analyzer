/**
 * Service worker. Owns the database and the account session.
 *
 * The extension is a collector: it stores what capture finds, scrolls when asked, and
 * syncs to the account. Indexing runs on the server, so nothing here calls a model or
 * holds a model key.
 *
 * MV3 service workers are killed when idle and revived on the next event, so nothing here
 * may assume continuity. What matters lives in IndexedDB and storage.local.
 */

import * as db from './db';
import * as ledger from './ledger';
import { redact } from './redact';
import { reserveRanks } from './order';
import { getAccount, signIn, signOut, signUp } from './account';
import { getSyncStatus, onLibraryCleared, resetSync, scheduleSync, syncNow } from './sync';
import { getSettings, lockDownStorage, migrateSettings, setSettings } from './settings';
import { PORT, type AccountState, type Broadcast, type Request, type Response } from '../messaging';
import { savedFeedPath } from '../routes';
import { forgetCollections, rememberCollection, validCollection } from './collections';
import { toRecord, type CapturedPost } from '../types';

// Assert on every wake, not just install — see settings.ts.
void lockDownStorage();
// Land any pending settings migration in storage, which is also what removes the OpenAI
// key an older build kept.
void migrateSettings();
chrome.runtime.onInstalled.addListener(() => {
  void lockDownStorage();
  void migrateSettings();
});
// Catch up on anything captured since the last upload.
scheduleSync();

/**
 * Open ports from content scripts and the popup. Using ports rather than
 * `chrome.tabs.sendMessage` keeps `tabs` off the permission list.
 */
const subscribers = new Set<chrome.runtime.Port>();

/**
 * Whether the page should currently be auto-scrolling.
 *
 * `harvest` is a command, and it was sent over a channel that drops: a port reconnects a
 * second after the worker idles out, so a Stop pressed in that window reached the popup
 * and never reached the page, which kept scrolling and capturing. Held here and replayed
 * on connect. Resetting to false when the worker dies is correct — nothing is running
 * then either.
 */
let harvesting = false;

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PORT) return;
  subscribers.add(port);
  port.onDisconnect.addListener(() => {
    void chrome.runtime.lastError;
    subscribers.delete(port);
  });
  // Bring a fresh subscriber up to date immediately — both what has been found and what
  // it should be doing about it.
  void db.count().then((total) => {
    try {
      port.postMessage({ type: 'found', total } satisfies Broadcast);
      port.postMessage({ type: 'harvest', action: harvesting ? 'start' : 'stop' } satisfies Broadcast);
    } catch {
      subscribers.delete(port);
    }
  });
});

function setHarvest(action: 'start' | 'stop'): void {
  harvesting = action === 'start';
  broadcast({ type: 'harvest', action });
}

function broadcast(msg: Broadcast): void {
  for (const port of subscribers) {
    try {
      port.postMessage(msg);
    } catch {
      subscribers.delete(port);
    }
  }
}

async function broadcastFound(): Promise<void> {
  broadcast({ type: 'found', total: await db.count() });
}

// Clear Library in the web app: this browser's copy goes too, so it cannot sync it back.
// The only caller of either clear (invariant 4).
onLibraryCleared(async () => {
  setHarvest('stop');
  await db.clearLibrary();
  await ledger.clearAll();
  await forgetCollections();
  await broadcastFound();
});

chrome.runtime.onMessage.addListener((req: Request, sender, sendResponse) => {
  // A content script runs inside instagram.com. Nothing there may sign in, out or
  // anywhere else on the user's behalf.
  const fromPage = sender.tab !== undefined;
  const request = fromPage && String(req?.type).startsWith('account:')
    ? Promise.reject(new Error('Account requests are only accepted from the extension.'))
    : handle(req);
  if (req?.type === 'posts:captured' && sender.url) void rememberLibrary(sender.url);
  request
    .then((value) => sendResponse({ ok: true, value } satisfies Response))
    .catch((err: unknown) =>
      sendResponse({
        ok: false,
        error: redact(err instanceof Error ? err.message : String(err)),
      } satisfies Response),
    );
  return true; // keep the channel open for the async reply
});

async function handle(req: Request): Promise<unknown> {
  switch (req.type) {
    case 'posts:captured': {
      // This payload started life in the page's own JS context, so it is bounded before it
      // is stored: an unbounded array or a multi-megabyte caption would otherwise land in
      // the database and, from there, in a prompt the user pays for.
      const posts = Array.isArray(req.posts) ? req.posts.slice(0, MAX_POSTS_PER_MESSAGE) : [];
      if (!posts.length) return { inserted: 0 };

      // Posts arrive in feed order, which is save order — see background/order.ts. Ranks
      // are reserved for the whole batch at once so a concurrent message can't interleave.
      const ranks = await reserveRanks(req.pageId, posts.length);
      const collection = validCollection(req.collection);
      const renamed = collection ? await rememberCollection(collection) : false;
      const { inserted, refreshed } = await db.putIfNew(
        posts.map((p: CapturedPost, i) => toRecord(clamp(p), ranks[i] ?? null, collection?.id ?? null)),
        req.source === 'grid' ? 'grid' : 'network',
      );
      // A refreshed record matters too: its Instagram CDN thumbnail may have just been
      // replaced with a fresh signed URL, which the thumbnail copy needs.
      if (renamed || inserted > 0 || refreshed > 0) scheduleSync();
      if (inserted > 0) await broadcastFound();
      return { inserted, refreshed };
    }

    case 'posts:count':
      return db.count();

    case 'posts:strays':
      return { count: (await db.strays(req.since)).length };

    case 'posts:prune': {
      const removed = await db.prune(req.since);
      if (removed > 0) {
        scheduleSync();
        await broadcastFound();
      }
      return { removed };
    }

    case 'find:start':
      // Free: scrolling only lets Instagram load what it would load anyway.
      setHarvest('start');
      return { finding: true };

    case 'find:stop':
      setHarvest('stop');
      return { finding: false };

    case 'harvest:finished':
      // A natural end used to leave `harvesting=true` in the worker forever. The next
      // popup/content port to connect replayed "start" and silently began another sweep.
      if (harvesting) setHarvest('stop');
      // Finishing a sweep sends what it found to the account; indexing happens there.
      scheduleSync(500);
      return { stopped: true, reason: req.reason };

    case 'library:url': {
      const stored = await chrome.storage.local.get(LIBRARY_KEY);
      return `${INSTAGRAM}${typeof stored[LIBRARY_KEY] === 'string' ? stored[LIBRARY_KEY] : '/'}`;
    }

    case 'settings:get':
      return getSettings();

    case 'theme:set': {
      const settings = await setSettings({ theme: req.theme === 'dark' ? 'dark' : 'light' });
      // storage.local is TRUSTED_CONTEXTS, so a content script never receives its change
      // events. The port is how an open instagram.com tab hears about it without a reload.
      broadcast({ type: 'settings', settings });
      return settings;
    }

    case 'account:get':
      // Opening the popup is a good moment to pick up posts indexed in the web app.
      scheduleSync(500);
      return accountState();

    case 'account:sign-in':
      await signIn(req.email, req.password);
      // Start from a clean slate: the account may have been changed from elsewhere.
      await resetSync();
      await syncNow();
      return accountState();

    case 'account:sign-up': {
      const { confirm } = await signUp(req.email, req.password);
      if (!confirm) {
        await resetSync();
        await syncNow();
      }
      return { ...(await accountState()), confirmEmail: confirm };
    }

    case 'account:sign-out':
      await signOut();
      await resetSync();
      return accountState();

    case 'account:sync':
      await syncNow();
      return accountState();

    default: {
      const exhaustive: never = req;
      throw new Error(`Unhandled request: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** One page of the saved grid is ~12 tiles; a generous ceiling still bounds the damage. */
const MAX_POSTS_PER_MESSAGE = 500;
const MAX_CAPTION_CHARS = 4000;
const MAX_HASHTAGS = 60;

/** Who is signed in and how the last sync went: the account as it may leave the worker. */
async function accountState(): Promise<AccountState> {
  const [{ email }, sync] = await Promise.all([getAccount(), getSyncStatus()]);
  return { email, ...sync };
}

const INSTAGRAM = 'https://www.instagram.com';
const LIBRARY_KEY = 'libraryPath';

/**
 * Remembers whose saved feed is being captured, so the popup can open it directly. Taken
 * from `sender.url`, which the browser sets, never from anything the page sent.
 */
async function rememberLibrary(url: string): Promise<void> {
  const { origin, pathname } = new URL(url);
  const path = origin === INSTAGRAM ? savedFeedPath(pathname) : null;
  if (path) await chrome.storage.local.set({ [LIBRARY_KEY]: path });
}

/** Bound the free-text fields a page could have inflated before they reach the DB. */
function clamp(p: CapturedPost): CapturedPost {
  return {
    ...p,
    caption: String(p.caption ?? '').slice(0, MAX_CAPTION_CHARS),
    altText: p.altText === null ? null : String(p.altText).slice(0, MAX_CAPTION_CHARS),
    audioTrackName:
      p.audioTrackName === null ? null : String(p.audioTrackName).slice(0, 200),
    handle: String(p.handle ?? '').slice(0, 100),
    thumbnailUrl: safeMediaUrl(p.thumbnailUrl),
    // Only a reel has a video, and only from Instagram's CDN.
    videoUrl: p.isVideo === true ? safeMediaUrl(p.videoUrl) || null : null,
    hashtags: (Array.isArray(p.hashtags) ? p.hashtags : [])
      .slice(0, MAX_HASHTAGS)
      .map((t) => String(t).slice(0, 100)),
  };
}

/** Accept only bounded Instagram-hosted HTTPS images from the untrusted page bridge. */
function safeMediaUrl(value: unknown): string {
  const raw = String(value ?? '').slice(0, 4_000);
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    const allowed =
      host === 'instagram.com' ||
      host.endsWith('.instagram.com') ||
      host.endsWith('.cdninstagram.com') ||
      host.endsWith('.fbcdn.net');
    return url.protocol === 'https:' && allowed ? url.href : '';
  } catch {
    return '';
  }
}

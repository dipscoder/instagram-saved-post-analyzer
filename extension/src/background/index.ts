/**
 * Service worker. Owns the API key, the database, and every model call.
 *
 * MV3 service workers are killed when idle and revived on the next event, so nothing here
 * may assume continuity. Indexing progress lives in IndexedDB rather than memory, which
 * is what makes "resume on failure" fall out for free: on wake we simply ask the DB what
 * is still uncategorised.
 */

import * as db from './db';
import * as ledger from './ledger';
import { Categorizer } from './categorize';
import { estimateUsd, getProvider, PROVIDERS, redact, testKey } from './providers/index';
import { reserveRanks } from './order';
import { resetSpend } from './spend';
import {
  clearKey,
  getSafeSettings,
  getSettings,
  lockDownStorage,
  migrateSettings,
  setSettings,
} from './settings';
import { PORT, type Broadcast, type Request, type Response, type Stats } from '../messaging';
import { IDLE_PROGRESS, toRecord, type IndexProgress } from '../types';
import type { CapturedPost } from '../types';

// Assert on every wake, not just install — see settings.ts.
void lockDownStorage();
// Land any pending settings migration in storage, so an already-open instagram.com tab
// hears about it through storage.onChanged rather than waiting for a reload.
void migrateSettings();
chrome.runtime.onInstalled.addListener(() => {
  void lockDownStorage();
  void migrateSettings();
});

let lastProgress: IndexProgress = IDLE_PROGRESS;

const categorizer = new Categorizer((p) => {
  lastProgress = p;
  broadcast({ type: 'progress', progress: p });
});

/**
 * Open ports from content scripts and the popup. Using ports rather than
 * `chrome.tabs.sendMessage` keeps `tabs` off the permission list.
 */
const subscribers = new Set<chrome.runtime.Port>();

/**
 * Whether the page should currently be auto-scrolling.
 *
 * `harvest` is a command, and it was sent over a channel that drops: the library's port
 * reconnects a second after the worker idles out, so a Pause pressed in that window
 * reached the popup and never reached the page, which kept scrolling and capturing. Held
 * here and replayed on connect. Resetting to false when the worker dies is correct —
 * nothing is running then either.
 */
let harvesting = false;

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PORT) return;
  subscribers.add(port);
  port.onDisconnect.addListener(() => {
    void chrome.runtime.lastError;
    subscribers.delete(port);
  });
  // Bring a fresh subscriber up to date immediately — both what is happening and what it
  // should be doing about it.
  void categorizer.progress().then((progress) => {
    try {
      port.postMessage({ type: 'progress', progress } satisfies Broadcast);
      port.postMessage({
        type: 'harvest',
        action: harvesting ? 'start' : 'stop',
      } satisfies Broadcast);
    } catch {
      subscribers.delete(port);
    }
  });
});

function setHarvest(action: 'start' | 'stop'): void {
  harvesting = action === 'start';
  broadcast({ type: 'harvest', action });
}

/** Surface a background failure through the channel the UI is already watching. */
function reportFailure(err: unknown): void {
  const progress: IndexProgress = {
    ...lastProgress,
    phase: 'error',
    message: redact(err instanceof Error ? err.message : String(err)),
  };
  lastProgress = progress;
  broadcast({ type: 'progress', progress });
}

function trackCompletion(): void {
  void categorizer
    .completion()
    ?.then(async () => {
      const progress = await categorizer.progress();
      if (progress.phase === 'done') await chrome.storage.local.set({ lastRunAt: Date.now() });
    })
    .catch(reportFailure);
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

chrome.runtime.onMessage.addListener((req: Request, _sender, sendResponse) => {
  handle(req)
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
      const { inserted, refreshed } = await db.putIfNew(
        posts.map((p: CapturedPost, i) => toRecord(clamp(p), ranks[i] ?? null)),
      );
      if (inserted > 0 || refreshed > 0) {
        // Push the new total straight away so the library's counts and rows update as
        // you scroll. Existing records matter too: their Instagram CDN thumbnail may
        // have just been replaced with a fresh signed URL.
        broadcast({ type: 'progress', progress: await categorizer.progress() });
        if (refreshed > 0) {
          // Counts do not change when an expired CDN URL is refreshed, so a progress
          // event alone would not make the library query its cards again.
          broadcast({ type: 'posts:updated' });
        }

        const settings = await getSettings();
        // Auto-index picks up newly captured posts without the user asking, but only
        // when a key exists and a run isn't already in flight.
        // `isRunning()` alone was not enough: a paused run is not running, so the next
        // captured tile restarted the very spend the user had just stopped.
        if (
          settings.autoIndex &&
          settings.apiKey &&
          !harvesting &&
          !categorizer.isRunning() &&
          !categorizer.isPaused()
        ) {
          void categorizer.start().catch(reportFailure);
        }
      }
      return { inserted, refreshed };
    }

    case 'posts:query':
      return db.query({
        search: req.search,
        categories: req.categories,
        limit: req.limit,
        sort: req.sort,
      });

    case 'posts:stats': {
      const [s, ledgerCount, stored] = await Promise.all([
        db.stats(),
        ledger.count(),
        chrome.storage.local.get('lastRunAt'),
      ]);
      return {
        ...s,
        lastRunAt: (stored['lastRunAt'] as number | undefined) ?? null,
        ledgerCount,
      } satisfies Stats;
    }

    case 'post:get':
      return (await db.byShortcode(String(req.shortcode ?? ''))) ?? null;

    case 'posts:strays':
      return { count: (await db.strays(req.since)).length };

    case 'posts:prune': {
      const removed = await db.prune(req.since);
      if (removed > 0) broadcast({ type: 'progress', progress: await categorizer.progress() });
      return { removed };
    }

    case 'post:reindex': {
      const shortcode = String(req.shortcode ?? '');
      if (!/^[A-Za-z0-9_-]{5,30}$/.test(shortcode)) throw new Error('Invalid post id.');
      const settings = await getSettings();
      if (!settings.apiKey) throw new Error('Connect a model before re-indexing this post.');
      const post = await categorizer.reindexOne(shortcode);
      trackCompletion();
      return { post, progress: await categorizer.progress() };
    }

    case 'index:start': {
      const settings = await getSettings();
      if (!settings.apiKey) throw new Error('Connect a model before indexing.');
      // Freeze the queue before scrolling starts. A response can arrive immediately
      // after the harvest broadcast; reversing these two lines let it sneak into what
      // was supposed to be a fixed-size run.
      await categorizer.start();
      setHarvest('start');
      trackCompletion();
      return categorizer.progress();
    }

    case 'index:pause':
      setHarvest('stop');
      categorizer.pause();
      return categorizer.progress();

    case 'index:reindex':
      if (!(await getSettings()).apiKey) throw new Error('Connect a model before re-indexing.');
      // Without the catch, a failed `resetCategories` rejected into `void`: the page was
      // already scrolling, the button already said Pause, and nothing ever ran.
      await categorizer.reindex();
      setHarvest('start');
      trackCompletion();
      return categorizer.progress();

    case 'harvest:finished':
      // A natural end used to leave `harvesting=true` in the worker forever. The next
      // popup/content port to connect replayed "start" and silently began another sweep.
      if (req.reason === 'rate-limited') categorizer.pause();
      if (harvesting) setHarvest('stop');
      return { stopped: true, reason: req.reason };

    case 'index:quote':
      return categorizer.quoteReindex();

    case 'ledger:export':
      return ledger.exportAll();

    case 'ledger:import': {
      const result = await ledger.importAll(req.file);
      // Imported verdicts are only worth anything once they reach the posts. Clearing the
      // categorisation lets the next run replay them from the ledger for free.
      if (result.imported > 0) {
        await db.resetCategories();
        void categorizer.start().catch(reportFailure);
      }
      return result;
    }

    case 'index:progress':
      return categorizer.isRunning() ? categorizer.progress() : refreshProgress();

    case 'spend:reset':
      await resetSpend();
      return categorizer.progress();

    case 'settings:get':
      return {
        settings: await getSafeSettings(),
        providers: Object.values(PROVIDERS).map((p) => ({
          id: p.id,
          label: p.label,
          keyPlaceholder: p.keyPlaceholder,
          keysUrl: p.keysUrl,
          // per1kPosts is derived here so the token-per-post assumptions live in one
          // place rather than being re-guessed by whichever UI wants to show a price.
          models: p.models.map((m) => ({ ...m, per1kPosts: estimateUsd(m, 1000) })),
        })),
      };

    case 'settings:set': {
      // An empty apiKey in a patch means "unchanged", never "clear it" — the popup
      // shows a mask, and re-saving other fields must not wipe the key.
      const patch = { ...req.patch };
      if (patch.apiKey !== undefined && patch.apiKey.trim() === '') delete patch.apiKey;
      await setSettings(patch);
      const safe = await getSafeSettings();
      // storage.local is TRUSTED_CONTEXTS, so a content script never receives its change
      // events — the listener that used to carry this was dead. The port is the only way
      // an open instagram.com tab hears about a settings change without a reload.
      broadcast({ type: 'settings', settings: safe });
      return safe;
    }

    case 'settings:clear-key': {
      // Stop first: a run that loses its key mid-flight would otherwise fail noisily.
      categorizer.pause();
      await clearKey();
      return getSafeSettings();
    }

    case 'settings:test-key': {
      const { provider, model, apiKey } = await getSettings();
      if (!apiKey) throw new Error('No key saved yet.');
      const started = performance.now();
      await testKey(provider, apiKey, model);
      const ms = Math.round(performance.now() - started);
      return { ok: true, ms, model, provider: getProvider(provider).label };
    }

    case 'settings:test-candidate': {
      const apiKey = String(req.apiKey ?? '').trim();
      if (!apiKey || apiKey.length > 500) throw new Error('Enter a valid API key.');
      const provider = getProvider(req.provider);
      if (!provider.models.some((candidate) => candidate.id === req.model)) {
        throw new Error('Choose a model offered by that provider.');
      }
      const started = performance.now();
      await testKey(req.provider, apiKey, req.model);
      return {
        ok: true,
        ms: Math.round(performance.now() - started),
        model: req.model,
        provider: provider.label,
      };
    }

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

/** Progress for an idle worker: derive counts from the DB rather than stale memory. */
async function refreshProgress(): Promise<IndexProgress> {
  const fresh = await categorizer.progress();
  const phase =
    lastProgress.phase === 'running'
      ? 'paused' // the worker was killed mid-run; it is not running now
      : fresh.total > 0 && fresh.categorized === fresh.total
        ? 'done'
        : fresh.phase;
  lastProgress = { ...fresh, phase };
  return lastProgress;
}

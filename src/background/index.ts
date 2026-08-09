/**
 * Service worker. Owns the API key, the database, and every model call.
 *
 * MV3 service workers are killed when idle and revived on the next event, so nothing here
 * may assume continuity. Indexing progress lives in IndexedDB rather than memory, which
 * is what makes "resume on failure" fall out for free: on wake we simply ask the DB what
 * is still uncategorised.
 */

import * as db from './db';
import { Categorizer } from './categorize';
import { estimateUsd, getProvider, PROVIDERS, redact, testKey } from './providers/index';
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

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PORT) return;
  subscribers.add(port);
  port.onDisconnect.addListener(() => subscribers.delete(port));
  // Bring a fresh subscriber up to date immediately.
  void categorizer.progress().then((progress) => {
    try {
      port.postMessage({ type: 'progress', progress } satisfies Broadcast);
    } catch {
      subscribers.delete(port);
    }
  });
});

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
      const inserted = await db.putIfNew(req.posts.map((p: CapturedPost) => toRecord(p)));
      if (inserted > 0) {
        // Push the new total straight away so the library's counts and rows update as
        // you scroll, whether or not categorisation is about to run.
        broadcast({ type: 'progress', progress: await categorizer.progress() });

        const settings = await getSettings();
        // Auto-index picks up newly captured posts without the user asking, but only
        // when a key exists and a run isn't already in flight.
        if (settings.autoIndex && settings.apiKey && !categorizer.isRunning()) {
          void categorizer.start();
        }
      }
      return { inserted };
    }

    case 'posts:query':
      return db.query({
        search: req.search,
        categories: req.categories,
        limit: req.limit,
      });

    case 'posts:stats': {
      const s = await db.stats();
      const { lastRunAt } = await chrome.storage.local.get('lastRunAt');
      return { ...s, lastRunAt: (lastRunAt as number | undefined) ?? null } satisfies Stats;
    }

    case 'index:start': {
      // The page owns scrolling, so starting a run means asking whichever tab is on the
      // saved grid to start harvesting too. A tab that isn't there simply never hears it.
      broadcast({ type: 'harvest', action: 'start' });
      void categorizer.start().then(() => chrome.storage.local.set({ lastRunAt: Date.now() }));
      return categorizer.progress();
    }

    case 'index:pause':
      broadcast({ type: 'harvest', action: 'stop' });
      categorizer.pause();
      return categorizer.progress();

    case 'index:reindex':
      broadcast({ type: 'harvest', action: 'start' });
      void categorizer.reindex();
      return categorizer.progress();

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
      return getSafeSettings();
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

    default: {
      const exhaustive: never = req;
      throw new Error(`Unhandled request: ${JSON.stringify(exhaustive)}`);
    }
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

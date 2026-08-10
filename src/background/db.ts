/**
 * IndexedDB store for post records.
 *
 * Not chrome.storage.local: that caps around 10 MB, and a few thousand posts with
 * captions clears it easily. The manifest asks for `unlimitedStorage` so the browser
 * doesn't evict this DB when disk pressure rises.
 */

import type { SortKey } from '../messaging';
import { SCHEMA_VERSION, type PostRecord } from '../types';

const DB_NAME = 'saved-index';
const DB_VERSION = 3;
const STORE = 'posts';

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = req.result;
      const from = ev.oldVersion || 0;

      if (!db.objectStoreNames.contains(STORE)) {
        // Keying on shortcode makes dedupe a property of the store rather than
        // something the write path has to remember to do.
        const store = db.createObjectStore(STORE, { keyPath: 'shortcode' });
        store.createIndex('category', 'category');
        store.createIndex('postedAt', 'postedAt');
        store.createIndex('categorizedAt', 'categorizedAt');
      }

      const store = req.transaction?.objectStore(STORE);
      if (!store) return;

      // v2 → v3 renamed the field the index was built on.
      if (from > 0 && from < 3) {
        if (store.indexNames.contains('savedAt')) store.deleteIndex('savedAt');
        if (!store.indexNames.contains('postedAt')) store.createIndex('postedAt', 'postedAt');
      }

      if (from > 0 && from < SCHEMA_VERSION) {
        const cursorReq = store.openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor) {
            cursor.update(upgrade(cursor.value as Record<string, unknown>, from));
            cursor.continue();
          }
        };
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
  return dbPromise;
}

/**
 * One stored record, brought up to the current schema. Pure, so `npm run verify` can
 * exercise it without a browser.
 *
 * Everything a migration cannot honestly know is left null rather than invented:
 *
 * - **v1 → v2, `seenInSavedFeed`.** These records were captured before the capture layer
 *   was fenced to the saved grid, so we genuinely do not know whether they were saved.
 *   The first full sweep re-stamps the real ones; the rest are then offered for removal.
 * - **v2 → v3, `savedAt` → `postedAt`.** A rename, not a change of meaning — the value was
 *   always the post's own timestamp. `firstSeenAt` and `savedRank` are null because we
 *   never recorded either, and back-dating them from `postedAt` would be a lie that reads
 *   like a fact.
 */
export function upgrade(rec: Record<string, unknown>, from: number): Record<string, unknown> {
  const next = { ...rec };

  if (from < 2) next['seenInSavedFeed'] = null;

  if (from < 3) {
    next['postedAt'] = next['postedAt'] ?? next['savedAt'] ?? null;
    delete next['savedAt'];
    next['firstSeenAt'] = null;
    next['savedRank'] = null;
  }

  next['schemaVersion'] = SCHEMA_VERSION;
  return next;
}

function tx(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  return open().then((db) => db.transaction(STORE, mode).objectStore(STORE));
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

/**
 * Insert records that aren't already stored. An existing record keeps everything it
 * already has — re-capturing a post you already categorised must never wipe its summary —
 * but its `seenInSavedFeed` stamp is always refreshed, because seeing it again is the
 * evidence that it is still saved. Returns how many were new.
 */
export async function putIfNew(records: PostRecord[]): Promise<number> {
  if (!records.length) return 0;
  const db = await open();

  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, 'readwrite');
    const store = t.objectStore(STORE);
    let inserted = 0;

    for (const rec of records) {
      const get = store.get(rec.shortcode);
      get.onsuccess = () => {
        const existing = get.result as PostRecord | undefined;
        if (existing) {
          // Interception carries fields the DOM fallback can't see. Fill the gaps
          // without touching anything already set.
          const merged = backfill(existing, rec) ?? existing;
          store.put({ ...merged, seenInSavedFeed: rec.seenInSavedFeed });
          return;
        }
        store.put(rec);
        inserted++;
      };
    }

    t.oncomplete = () => resolve(inserted);
    t.onerror = () => reject(t.error ?? new Error('putIfNew failed'));
  });
}

/** Returns a merged record if `incoming` fills any gap, else null (nothing to write). */
function backfill(existing: PostRecord, incoming: PostRecord): PostRecord | null {
  const merged = { ...existing };
  let changed = false;

  const fill = <K extends keyof PostRecord>(key: K) => {
    const cur = existing[key];
    const next = incoming[key];
    const empty = cur === null || cur === '' || (Array.isArray(cur) && cur.length === 0);
    const hasNext = next !== null && next !== '' && !(Array.isArray(next) && next.length === 0);
    if (empty && hasNext) {
      merged[key] = next;
      changed = true;
    }
  };

  fill('caption');
  fill('hashtags');
  fill('handle');
  fill('thumbnailUrl');
  fill('durationSec');
  fill('audioTrackName');
  fill('altText');
  fill('postedAt');

  return changed ? merged : null;
}

export async function update(record: PostRecord): Promise<void> {
  const store = await tx('readwrite');
  await wrap(store.put(record));
}

export async function updateMany(records: PostRecord[]): Promise<void> {
  if (!records.length) return;
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(STORE, 'readwrite');
    const store = t.objectStore(STORE);
    for (const r of records) store.put(r);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error ?? new Error('updateMany failed'));
  });
}

export async function all(): Promise<PostRecord[]> {
  const store = await tx('readonly');
  return wrap(store.getAll() as IDBRequest<PostRecord[]>);
}

export async function count(): Promise<number> {
  const store = await tx('readonly');
  return wrap(store.count());
}

/** Posts that no tier has classified yet, oldest-captured first. */
export async function pendingCategorization(limit: number): Promise<PostRecord[]> {
  const records = await all();
  return records.filter((r) => r.categorizedAt === null).slice(0, limit);
}

export interface QueryOpts {
  search: string;
  categories: string[];
  limit: number;
  sort: SortKey;
}

/**
 * Save order first, because a library of saved things is a list of things you saved —
 * ordering it by when the post happened to be published files a 2019 clip you saved
 * yesterday at the very bottom. Records with no rank predate the field and sort last;
 * post date breaks ties within them.
 */
const SORTS: Record<SortKey, (a: PostRecord, b: PostRecord) => number> = {
  saved: (a, b) => (b.savedRank ?? 0) - (a.savedRank ?? 0) || (b.postedAt ?? 0) - (a.postedAt ?? 0),
  newest: (a, b) => (b.postedAt ?? 0) - (a.postedAt ?? 0),
  oldest: (a, b) => (a.postedAt ?? Infinity) - (b.postedAt ?? Infinity),
};

export interface QueryResult {
  posts: PostRecord[];
  /** Matches before the limit, so the UI can say "200 of 412" instead of quietly lying. */
  total: number;
}

export async function query(opts: QueryOpts): Promise<QueryResult> {
  const terms = tokenize(opts.search);
  const wanted = new Set(opts.categories);
  const records = await all();

  const filtered = records.filter((r) => {
    if (wanted.size) {
      const cat = r.category ?? 'Uncategorized';
      if (!wanted.has(cat)) return false;
    }
    return matchesSearch(r, terms);
  });

  filtered.sort(SORTS[opts.sort] ?? SORTS.saved);
  return { posts: filtered.slice(0, opts.limit), total: filtered.length };
}

/**
 * Every term has to appear somewhere, in any order. A single `includes` over the joined
 * text meant "pasta recipe" missed a post summarised "recipe for creamy pasta" — which is
 * how people actually type, so it missed constantly.
 */
export function tokenize(search: string): string[] {
  return search
    .toLowerCase()
    .split(/\s+/)
    // Hashtags are stored bare, so typing "#recipe" should still find them.
    .map((t) => t.replace(/^#/, '').trim())
    .filter(Boolean);
}

export function matchesSearch(r: PostRecord, terms: string[]): boolean {
  if (!terms.length) return true;
  const hay = haystack(r);
  return terms.every((t) => hay.includes(t));
}

/**
 * Everything a post carries that someone might plausibly remember about it. Alt text and
 * the audio track earn their place: on a reel with no caption they are often the only
 * text that exists, and "that one with the Nils track" is a real way to look for a post.
 */
function haystack(r: PostRecord): string {
  return [
    r.summary,
    r.caption,
    r.handle,
    r.category,
    r.subcategory,
    r.tags.join(' '),
    r.hashtags.join(' '),
    r.altText,
    r.audioTrackName,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export async function stats(): Promise<{
  total: number;
  categorized: number;
  byCategory: Record<string, number>;
}> {
  const records = await all();
  const byCategory: Record<string, number> = {};
  let categorized = 0;

  for (const r of records) {
    if (r.categorizedAt !== null) categorized++;
    const key = r.category ?? 'Uncategorized';
    byCategory[key] = (byCategory[key] ?? 0) + 1;
  }

  return { total: records.length, categorized, byCategory };
}

/**
 * Records the saved feed did not list during a sweep that reached the end of it.
 *
 * Two kinds land here and both should go: posts unsaved on Instagram since they were
 * captured, and posts an older build swept up from the home feed, a profile grid or a
 * related-posts strip. `since` must be the moment that sweep *started*, and the caller
 * must only ask after the sweep completed — an interrupted one has simply not reached
 * the rest of the feed yet, and pruning on it would delete posts that are still saved.
 */
export async function strays(since: number): Promise<PostRecord[]> {
  const records = await all();
  return records.filter((r) => (r.seenInSavedFeed ?? 0) < since);
}

export async function prune(since: number): Promise<number> {
  const doomed = await strays(since);
  if (!doomed.length) return 0;

  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, 'readwrite');
    const store = t.objectStore(STORE);
    for (const r of doomed) store.delete(r.shortcode);
    t.oncomplete = () => resolve(doomed.length);
    t.onerror = () => reject(t.error ?? new Error('prune failed'));
  });
}

/** Clears categorisation so a re-index runs from scratch. Captured data is kept. */
export async function resetCategories(): Promise<void> {
  const records = await all();
  const cleared = records.map((r) => ({
    ...r,
    category: null,
    subcategory: null,
    tags: [],
    summary: null,
    categorizedAt: null,
    modelUsed: null,
  }));
  await updateMany(cleared);
}

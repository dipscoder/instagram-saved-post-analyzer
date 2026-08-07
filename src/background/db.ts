/**
 * IndexedDB store for post records.
 *
 * Not chrome.storage.local: that caps around 10 MB, and a few thousand posts with
 * captions clears it easily. The manifest asks for `unlimitedStorage` so the browser
 * doesn't evict this DB when disk pressure rises.
 */

import type { PostRecord } from '../types';

const DB_NAME = 'saved-index';
const DB_VERSION = 1;
const STORE = 'posts';

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        // Keying on shortcode makes dedupe a property of the store rather than
        // something the write path has to remember to do.
        const store = db.createObjectStore(STORE, { keyPath: 'shortcode' });
        store.createIndex('category', 'category');
        store.createIndex('savedAt', 'savedAt');
        store.createIndex('categorizedAt', 'categorizedAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
  return dbPromise;
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
 * Insert records that aren't already stored. Existing records are left completely
 * alone — re-capturing a post you already categorised must never wipe its summary.
 * Returns how many were new.
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
          const merged = backfill(existing, rec);
          if (merged) store.put(merged);
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
  fill('savedAt');

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
}

export async function query(opts: QueryOpts): Promise<PostRecord[]> {
  const needle = opts.search.trim().toLowerCase();
  const wanted = new Set(opts.categories);
  const records = await all();

  const filtered = records.filter((r) => {
    if (wanted.size) {
      const cat = r.category ?? 'Uncategorized';
      if (!wanted.has(cat)) return false;
    }
    if (!needle) return true;
    const hay = `${r.summary ?? ''} ${r.caption} ${r.handle} ${r.category ?? ''} ${r.tags.join(' ')}`;
    return hay.toLowerCase().includes(needle);
  });

  filtered.sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
  return filtered.slice(0, opts.limit);
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

/**
 * IndexedDB store for post records.
 *
 * Not chrome.storage.local: that caps around 10 MB, and a few thousand posts with
 * captions clears it easily. The manifest asks for `unlimitedStorage` so the browser
 * doesn't evict this DB when disk pressure rises.
 *
 * Three stores, split along the line that actually matters:
 *
 *   `posts`    — a disposable view of what is currently saved. Free to rebuild: scroll
 *                the grid again and it comes back.
 *   `analysis` — the ledger, in ledger.ts. What a model was *paid* to say. Irreproducible
 *                without spending the money a second time, so nothing in this file is
 *                allowed to delete it. See ledger.ts for the whole argument.
 *   `indexQueue` — the fixed members and progress of the current run. Disposable after
 *                  the next run starts, but persisted so worker restarts keep the target.
 *   `sync`     — what was last uploaded to the account, per post. See sync.ts.
 */

import type { SortKey } from '../messaging';
import { SCHEMA_VERSION, type PostRecord } from '../types';

const DB_NAME = 'saved-index';
const DB_VERSION = 7;
const STORE = 'posts';

/** The ledger's store. Created here because the upgrade transaction is here. */
export const LEDGER_STORE = 'analysis';
export const INDEX_QUEUE_STORE = 'indexQueue';
/** What has been uploaded to the account: post digests, verdict digests, thumbnails. */
export const SYNC_STORE = 'sync';
export const LEDGER_SYNC_STORE = 'ledgerSync';
export const THUMB_STORE = 'thumbs';

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = req.result;
      const from = ev.oldVersion || 0;

      if (!db.objectStoreNames.contains(STORE)) {
        // Keying on shortcode makes dedupe a property of the store rather than
        // something the write path has to remember to do.
        db.createObjectStore(STORE, { keyPath: 'shortcode' });
      }
      if (!db.objectStoreNames.contains(LEDGER_STORE)) {
        db.createObjectStore(LEDGER_STORE, { keyPath: 'shortcode' });
      }
      if (!db.objectStoreNames.contains(INDEX_QUEUE_STORE)) {
        db.createObjectStore(INDEX_QUEUE_STORE, { keyPath: 'shortcode' });
      }
      for (const name of [SYNC_STORE, LEDGER_SYNC_STORE, THUMB_STORE]) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'shortcode' });
      }

      const store = req.transaction?.objectStore(STORE);
      if (!store) return;

      // v2 → v3 renamed the field one index was built on.
      if (store.indexNames.contains('savedAt')) store.deleteIndex('savedAt');

      // Declared unconditionally rather than only on the create-new path. A profile that
      // upgraded from v1 took the branch above only for `postedAt`, so it has been
      // running without the other two ever since — an index that exists on a fresh
      // install and not on an upgraded one is the kind of difference that makes a bug
      // reproduce on exactly one machine.
      for (const name of ['category', 'postedAt', 'categorizedAt'] as const) {
        if (!store.indexNames.contains(name)) store.createIndex(name, name);
      }

      // Gated on "this is an upgrade", not on SCHEMA_VERSION. The two constants used to
      // be equal by coincidence; now that they aren't, tying the rewrite to the record
      // version means a future SCHEMA_VERSION bump without a matching DB_VERSION bump
      // would skip the migration silently. `upgrade` is idempotent, so a redundant pass
      // costs one walk and risks nothing.
      if (from > 0) {
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
    req.onsuccess = () => {
      const db = req.result;
      // Another context upgrading the DB would otherwise block on this open handle
      // forever. Close and drop the cached promise so the next call re-opens cleanly.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
        invalidate();
        invalidateQueue();
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    // None of the three handlers above fire when an open is blocked by another context
    // still holding the previous version. Without this the promise never settles, and
    // because it is cached every later call awaits it forever — the whole extension goes
    // quiet with no error anywhere.
    req.onblocked = () =>
      reject(new Error('The database is open in another window. Close it and try again.'));
  }).catch((err: unknown) => {
    // A rejected promise left in the cache would make every later call fail with the
    // original error, long after whatever caused it had passed.
    dbPromise = null;
    throw err;
  });
  return dbPromise;
}

/**
 * Every field the current schema promises, with the value a record that predates the
 * field should have. Applied on migration so nothing downstream has to defend against a
 * field that was simply never written: `tags.join(' ')` on a v1 record that has no
 * `tags` throws, and it throws inside the search path, on every keystroke, for that user
 * only.
 */
const FIELD_DEFAULTS: Record<string, unknown> = {
  permalink: '',
  handle: '',
  caption: '',
  hashtags: [],
  thumbnailUrl: '',
  isVideo: false,
  durationSec: null,
  audioTrackName: null,
  altText: null,
  postedAt: null,
  firstSeenAt: null,
  savedRank: null,
  seenInSavedFeed: null,
  category: null,
  subcategory: null,
  tags: [],
  summary: null,
  categorizedAt: null,
  modelUsed: null,
  transcript: null,
  ocrText: null,
  embedding: null,
  perceptualHash: null,
};

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

  if (from < 3) {
    next['postedAt'] = next['postedAt'] ?? next['savedAt'] ?? null;
    delete next['savedAt'];
  }

  for (const [key, fallback] of Object.entries(FIELD_DEFAULTS)) {
    if (next[key] === undefined) next[key] = Array.isArray(fallback) ? [...fallback] : fallback;
  }

  next['schemaVersion'] = SCHEMA_VERSION;
  return next;
}

function tx(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  return openDb().then((db) => db.transaction(STORE, mode).objectStore(STORE));
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

// --- the resident copy ------------------------------------------------------
//
// Every read used to be `getAll()`. That deserialises the entire store — at 20,000 posts,
// tens of megabytes of structured-clone work — and it happened on stats, on the pending
// queue, on the stray census, and on every keystroke in the search box. The store is the
// durable copy; this is the one the worker actually reads, held for as long as the worker
// lives and repaired in place by every write, so the cost is paid once per wake instead of
// once per question.
//
// Records are handed out by reference rather than copied. Nothing outside this file
// mutates a record — the categoriser spreads into a new object — and copying 20,000
// records per query would reintroduce most of what the cache just removed.

// The *promise* is cached, not the map it resolves to. Caching the result meant two
// callers arriving cold each ran their own getAll() and each built their own Map: the
// slower one won the cache slot, and every write that had already been applied to the
// faster one's map went somewhere nothing would ever read again. On a 20,000-post library
// that read takes long enough to make the overlap ordinary rather than exotic.
let cache: Promise<Map<string, PostRecord>> | null = null;

function invalidate(): void {
  cache = null;
}

function resident(): Promise<Map<string, PostRecord>> {
  cache ??= (async () => {
    const store = await tx('readonly');
    const rows = await wrap(store.getAll() as IDBRequest<PostRecord[]>);
    const map = new Map<string, PostRecord>();
    for (const r of rows) map.set(r.shortcode, r);
    return map;
  })().catch((err: unknown) => {
    cache = null;
    throw err;
  });
  return cache;
}

/**
 * Insert records that aren't already stored. An existing record keeps everything it
 * already has — re-capturing a post you already categorised must never wipe its summary —
 * but its `seenInSavedFeed` stamp is always refreshed, because seeing it again is the
 * evidence that it is still saved. Fresh non-empty capture fields also replace their
 * older values, because Instagram's signed media URLs expire. Returns both counts so the
 * UI can refresh a card even when the library size did not change.
 */
export async function putIfNew(
  records: PostRecord[],
): Promise<{ inserted: number; refreshed: number }> {
  if (!records.length) return { inserted: 0, refreshed: 0 };
  const db = await openDb();
  const live = await resident();

  return new Promise<{ inserted: number; refreshed: number }>((resolve, reject) => {
    const t = db.transaction(STORE, 'readwrite');
    const store = t.objectStore(STORE);
    const written: PostRecord[] = [];
    let inserted = 0;
    let refreshed = 0;

    for (const rec of records) {
      const get = store.get(rec.shortcode);
      get.onsuccess = () => {
        const existing = get.result as PostRecord | undefined;
        if (existing) {
          // Interception carries fields the DOM fallback cannot see, and a new saved-feed
          // capture also carries a current CDN URL. Preserve analysis while refreshing
          // mutable capture data.
          const merged = mergeCaptured(existing, rec) ?? existing;
          const next = { ...merged, seenInSavedFeed: rec.seenInSavedFeed };
          store.put(next);
          written.push(next);
          if (merged !== existing) refreshed++;
          return;
        }
        store.put(rec);
        written.push(rec);
        inserted++;
      };
    }

    t.oncomplete = () => {
      for (const r of written) live.set(r.shortcode, r);
      resolve({ inserted, refreshed });
    };
    // onabort as well as onerror: a quota failure aborts the transaction without
    // necessarily surfacing as a request error, and an unsettled promise here would
    // leave the capture path waiting forever.
    t.onerror = t.onabort = () => {
      invalidate();
      reject(t.error ?? new Error('putIfNew failed'));
    };
  });
}

/** Returns a merged record when a fresh capture improves it, else null. */
export function mergeCaptured(existing: PostRecord, incoming: PostRecord): PostRecord | null {
  const merged = { ...existing };
  let changed = false;

  const fill = <K extends keyof PostRecord>(key: K) => {
    const cur = existing[key];
    const next = incoming[key];
    const empty = cur === null || cur === undefined || cur === '' || (Array.isArray(cur) && cur.length === 0);
    const hasNext = next !== null && next !== undefined && next !== '' && !(Array.isArray(next) && next.length === 0);
    if (empty && hasNext) {
      merged[key] = next;
      changed = true;
    }
  };

  const refresh = <K extends keyof PostRecord>(key: K) => {
    const cur = existing[key];
    const next = incoming[key];
    const hasNext =
      next !== null &&
      next !== undefined &&
      next !== '' &&
      !(Array.isArray(next) && next.length === 0);
    const same =
      Array.isArray(cur) && Array.isArray(next)
        ? cur.length === next.length && cur.every((value, i) => value === next[i])
        : cur === next;
    if (hasNext && !same) {
      merged[key] = next;
      changed = true;
    }
  };

  // Captions and CDN thumbnails are mutable. In particular, Instagram's signed image
  // URLs expire: keeping the first non-empty URL forever turns an otherwise healthy
  // library into a wall of broken images after a few days. A fresh saved-feed capture is
  // authoritative for these fields, while empty DOM-fallback values never erase richer
  // data already on file.
  refresh('caption');
  refresh('hashtags');
  refresh('handle');
  refresh('thumbnailUrl');
  refresh('permalink');
  refresh('altText');
  refresh('audioTrackName');
  if (!existing.isVideo && incoming.isVideo) {
    merged.isVideo = true;
    changed = true;
  }
  fill('durationSec');
  fill('postedAt');
  // A v1/v2 record has no rank, and every sweep hands us the correct one. Without this
  // the whole migrated library scored 0 and sat below every new save forever, under the
  // sort that is both the default and the reason order.ts exists.
  fill('savedRank');

  return changed ? merged : null;
}

export async function update(record: PostRecord): Promise<void> {
  await updateMany([record]);
}

export async function updateMany(records: PostRecord[]): Promise<void> {
  if (!records.length) return;
  const db = await openDb();
  const live = await resident();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(STORE, 'readwrite');
    const store = t.objectStore(STORE);
    for (const r of records) store.put(r);
    t.oncomplete = () => {
      for (const r of records) live.set(r.shortcode, r);
      resolve();
    };
    t.onerror = t.onabort = () => {
      invalidate();
      reject(t.error ?? new Error('updateMany failed'));
    };
  });
}

export async function all(): Promise<PostRecord[]> {
  return [...(await resident()).values()];
}

export async function count(): Promise<number> {
  return (await resident()).size;
}

/** Posts that no tier has classified yet, oldest-captured first. */
export async function pendingCategorization(limit: number): Promise<PostRecord[]> {
  const out: PostRecord[] = [];
  for (const r of (await resident()).values()) {
    if (r.categorizedAt === null) out.push(r);
  }
  out.sort((a, b) => (a.firstSeenAt ?? 0) - (b.firstSeenAt ?? 0));
  return out.slice(0, Math.max(0, limit));
}

export async function byShortcode(shortcode: string): Promise<PostRecord | undefined> {
  return (await resident()).get(shortcode);
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
  const filtered: PostRecord[] = [];

  for (const r of (await resident()).values()) {
    if (wanted.size && !wanted.has(r.category ?? 'Uncategorized')) continue;
    if (!matchesSearch(r, terms)) continue;
    filtered.push(r);
  }

  filtered.sort(SORTS[opts.sort] ?? SORTS.saved);
  return { posts: filtered.slice(0, Math.max(0, opts.limit)), total: filtered.length };
}

/**
 * Every term has to appear somewhere, in any order. A single `includes` over the joined
 * text meant "pasta recipe" missed a post summarised "recipe for creamy pasta" — which is
 * how people actually type, so it missed constantly.
 */
export function tokenize(search: string): string[] {
  return fold(search)
    .split(/\s+/)
    // Hashtags are stored bare, so typing "#recipe" should still find them.
    .map((t) => t.replace(/^#/, '').trim())
    .filter(Boolean);
}

/**
 * Lowercase, and strip the accents rather than requiring them.
 *
 * Someone who saved a post about "crème brûlée" will type "creme brulee", and a search
 * that only matches the first spelling fails exactly the people whose libraries are not
 * in English. NFD splits a letter from its combining marks; the range erases the marks.
 */
function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * The folded text of a record, remembered.
 *
 * Rebuilding it meant concatenating and lowercasing nine fields for every record on every
 * keystroke — at 20,000 posts, megabytes of throwaway strings per typed character, which
 * is what "search feels laggy" actually was. Keyed on the record object, so a record
 * replaced by a write is not found here and is rebuilt once; nothing has to remember to
 * clear anything.
 */
const folded = new WeakMap<PostRecord, string>();

export function matchesSearch(r: PostRecord, terms: string[]): boolean {
  if (!terms.length) return true;
  let hay = folded.get(r);
  if (hay === undefined) {
    hay = haystack(r);
    folded.set(r, hay);
  }
  return terms.every((t) => hay.includes(t));
}

/**
 * Everything a post carries that someone might plausibly remember about it. Alt text and
 * the audio track earn their place: on a reel with no caption they are often the only
 * text that exists, and "that one with the Nils track" is a real way to look for a post.
 */
function haystack(r: PostRecord): string {
  return fold(
    [
      r.summary,
      r.caption,
      r.handle,
      r.category,
      r.subcategory,
      (r.tags ?? []).join(' '),
      (r.hashtags ?? []).join(' '),
      r.altText,
      r.audioTrackName,
    ]
      .filter(Boolean)
      .join(' '),
  );
}

export async function stats(): Promise<{
  total: number;
  categorized: number;
  byCategory: Record<string, number>;
}> {
  const live = await resident();
  const byCategory: Record<string, number> = {};
  let categorized = 0;

  for (const r of live.values()) {
    if (r.categorizedAt !== null) categorized++;
    const key = r.category ?? 'Uncategorized';
    byCategory[key] = (byCategory[key] ?? 0) + 1;
  }

  return { total: live.size, categorized, byCategory };
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
  const out: PostRecord[] = [];
  for (const r of (await resident()).values()) {
    if ((r.seenInSavedFeed ?? 0) < since) out.push(r);
  }
  return out;
}

/**
 * Forget posts that are no longer saved.
 *
 * Deliberately scoped to the `posts` store. The matching ledger entries stay: the user
 * paid for those, unsaving a post is not a request to destroy the receipt, and Instagram's
 * save button is a toggle people press twice more often than you would think. Re-saving a
 * pruned post costs nothing the second time because the verdict is still on file.
 */
export async function prune(since: number): Promise<number> {
  const doomed = await strays(since);
  if (!doomed.length) return 0;

  const db = await openDb();
  const live = await resident();
  return new Promise<number>((resolve, reject) => {
    const t = db.transaction(STORE, 'readwrite');
    const store = t.objectStore(STORE);
    for (const r of doomed) store.delete(r.shortcode);
    t.oncomplete = () => {
      for (const r of doomed) live.delete(r.shortcode);
      resolve(doomed.length);
    };
    t.onerror = t.onabort = () => {
      invalidate();
      reject(t.error ?? new Error('prune failed'));
    };
  });
}

/**
 * Clears categorisation so a re-index runs from scratch. Captured data is kept — and so
 * is the ledger, which is what makes a re-index cheap: the categoriser re-reads its own
 * receipts first and only pays for the posts whose input or taxonomy actually changed.
 */
export async function resetCategories(): Promise<void> {
  const db = await openDb();
  const live = await resident();

  // One cursor inside one transaction, rather than read-everything-then-write-everything.
  // A sweep starts the moment Re-index is pressed, so between a cold snapshot and its
  // write-back the top of the feed gets re-stamped — and the stale copy then overwrote
  // `seenInSavedFeed`, which is what the stray census reads. The user was offered a
  // one-click delete for posts they still had saved.
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(STORE, 'readwrite');
    const req = t.objectStore(STORE).openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return;
      const next: PostRecord = {
        ...(cursor.value as PostRecord),
        category: null,
        subcategory: null,
        tags: [],
        summary: null,
        categorizedAt: null,
        modelUsed: null,
      };
      cursor.update(next);
      live.set(next.shortcode, next);
      cursor.continue();
    };
    t.oncomplete = () => resolve();
    t.onerror = t.onabort = () => {
      invalidate();
      reject(t.error ?? new Error('resetCategories failed'));
    };
  });
}

/** Clear the categorisation fields for one post without touching its capture metadata. */
export async function resetCategory(shortcode: string): Promise<PostRecord> {
  const current = await byShortcode(shortcode);
  if (!current) throw new Error('That post is no longer in the local library.');
  const next: PostRecord = {
    ...current,
    category: null,
    subcategory: null,
    tags: [],
    summary: null,
    categorizedAt: null,
    modelUsed: null,
  };
  await update(next);
  return next;
}

// --- fixed run queue -------------------------------------------------------

/**
 * One immutable member of an indexing run.
 *
 * The old loop re-read every uncategorised post after each batch. When auto-scroll found
 * more posts, the finish line moved underneath the user: a run that began at 100 could
 * quietly become 800. This store freezes the shortcodes that existed at start. It lives
 * in IndexedDB so an MV3 worker restart resumes the same set rather than taking a new one.
 */
export interface IndexQueueEntry {
  shortcode: string;
  /** Skip both the paid-work ledger and deterministic rules for a user-requested retry. */
  force: boolean;
  /** Stable order within the run; IndexedDB itself orders these rows by shortcode. */
  order: number;
  done: boolean;
}

let queueCache: Promise<Map<string, IndexQueueEntry>> | null = null;

function invalidateQueue(): void {
  queueCache = null;
}

function residentQueue(): Promise<Map<string, IndexQueueEntry>> {
  queueCache ??= (async () => {
    const db = await openDb();
    const rows = await wrap(
      db.transaction(INDEX_QUEUE_STORE, 'readonly')
        .objectStore(INDEX_QUEUE_STORE)
        .getAll() as IDBRequest<IndexQueueEntry[]>,
    );
    return new Map(rows.map((r) => [r.shortcode, r]));
  })().catch((err: unknown) => {
    queueCache = null;
    throw err;
  });
  return queueCache;
}

/** Replace the previous run with an exact snapshot of these posts. */
export async function replaceIndexQueue(
  posts: Pick<PostRecord, 'shortcode'>[],
  force = false,
): Promise<void> {
  const db = await openDb();
  const entries = posts.map(
    (post, order): IndexQueueEntry => ({ shortcode: post.shortcode, force, order, done: false }),
  );
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(INDEX_QUEUE_STORE, 'readwrite');
    const store = t.objectStore(INDEX_QUEUE_STORE);
    store.clear();
    for (const entry of entries) store.put(entry);
    t.oncomplete = () => {
      queueCache = Promise.resolve(new Map(entries.map((r) => [r.shortcode, r])));
      resolve();
    };
    t.onerror = t.onabort = () => {
      invalidateQueue();
      reject(t.error ?? new Error('Could not create the indexing snapshot.'));
    };
  });
}

/** Add a forced retry to a live run without changing the rest of its frozen set. */
export async function appendIndexQueue(shortcode: string, force: boolean): Promise<void> {
  const db = await openDb();
  const live = await residentQueue();
  let highest = -1;
  for (const row of live.values()) highest = Math.max(highest, row.order);
  const entry: IndexQueueEntry = { shortcode, force, order: highest + 1, done: false };
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(INDEX_QUEUE_STORE, 'readwrite');
    t.objectStore(INDEX_QUEUE_STORE).put(entry);
    t.oncomplete = () => {
      live.set(shortcode, entry);
      resolve();
    };
    t.onerror = t.onabort = () => {
      invalidateQueue();
      reject(t.error ?? new Error('Could not queue the post.'));
    };
  });
}

export async function indexQueueStats(): Promise<{ total: number; completed: number; remaining: number }> {
  const rows = [...(await residentQueue()).values()];
  const completed = rows.reduce((n, r) => n + Number(r.done), 0);
  return { total: rows.length, completed, remaining: rows.length - completed };
}

export interface QueuedPost {
  post: PostRecord;
  force: boolean;
}

/** The next unfinished members of the frozen run, in their original snapshot order. */
export async function queuedCategorization(limit: number): Promise<QueuedPost[]> {
  const [posts, queue] = await Promise.all([resident(), residentQueue()]);
  const rows = [...queue.values()].filter((r) => !r.done).sort((a, b) => a.order - b.order);
  const out: QueuedPost[] = [];
  const stale: string[] = [];

  for (const row of rows) {
    const post = posts.get(row.shortcode);
    // A forced row is reset to null before it is queued. If it is already categorised
    // here, the verdict/post write succeeded and only the final queue acknowledgement
    // was interrupted; mark it done instead of buying the same answer again.
    if (!post || post.categorizedAt !== null) {
      stale.push(row.shortcode);
      continue;
    }
    out.push({ post, force: row.force });
    if (out.length >= limit) break;
  }

  if (stale.length) await completeIndexQueue(stale);
  return out;
}

/** Mark work complete only after its verdict and post record have both been stored. */
export async function completeIndexQueue(shortcodes: string[]): Promise<void> {
  if (!shortcodes.length) return;
  const db = await openDb();
  const live = await residentQueue();
  const updates = shortcodes
    .map((shortcode) => live.get(shortcode))
    .filter((r): r is IndexQueueEntry => Boolean(r))
    .map((r) => ({ ...r, done: true }));
  if (!updates.length) return;

  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(INDEX_QUEUE_STORE, 'readwrite');
    const store = t.objectStore(INDEX_QUEUE_STORE);
    for (const row of updates) store.put(row);
    t.oncomplete = () => {
      for (const row of updates) live.set(row.shortcode, row);
      resolve();
    };
    t.onerror = t.onabort = () => {
      invalidateQueue();
      reject(t.error ?? new Error('Could not advance the indexing queue.'));
    };
  });
}

/**
 * Mirrors the local library to the signed-in account: posts, the paid-analysis ledger,
 * and one small copy of each thumbnail.
 *
 * Local IndexedDB stays the working copy; the account is a mirror the web app reads. Each
 * sync plans a diff (sync-plan.ts) and applies it in batches, recording each batch only
 * after the server accepted it, so a worker killed mid-upload resumes from the last
 * confirmed batch on its next wake.
 *
 * The first sync for an account also pulls: the verdicts already paid for on another
 * browser, and which thumbnails are already stored, so neither is bought or copied twice.
 */

import * as db from './db';
import * as ledger from './ledger';
import { LEDGER_SYNC_STORE, openDb, SYNC_STORE, THUMB_STORE } from './db';
import { currentUserId, supabase } from './account';
import { fetchThumbnail, shrinkToJpeg } from './media';
import { redact } from './providers/index';
import {
  changed,
  digest,
  fromVerdictRow,
  planSync,
  planThumbnails,
  toVerdictRow,
  type ThumbState,
} from './sync-plan';

export interface SyncStatus {
  lastSyncAt: number | null;
  /** Posts currently mirrored to the account. */
  synced: number;
  /** Of those, how many have their thumbnail stored. */
  thumbnails: number;
  error: string | null;
}

const IDLE: SyncStatus = { lastSyncAt: null, synced: 0, thumbnails: 0, error: null };
const STATUS_KEY = 'syncStatus';
/** Which account the sync stores describe. A different user starts from scratch. */
const OWNER_KEY = 'syncOwner';
/** Which account has had its ledger and thumbnail state pulled down. */
const PULLED_KEY = 'syncPulled';
const UPSERT_BATCH = 500;
/** Deletes go in the query string, so they are batched smaller. */
const DELETE_BATCH = 100;
const PAGE = 1000;
/** Capture arrives in bursts while you scroll; one upload per burst is enough. */
const DEBOUNCE_MS = 3_000;
/**
 * Thumbnails are copied a few at a time, one download after another with a human-sized
 * pause between them, so the copy never looks like a burst against Instagram's CDN.
 */
const THUMBS_PER_PASS = 20;
const THUMB_GAP_MS: [number, number] = [400, 1200];
const NEXT_PASS_MS = 5_000;
const BUCKET = 'thumbnails';

let timer: ReturnType<typeof setTimeout> | null = null;
let running: Promise<void> | null = null;
let again = false;

export function scheduleSync(delayMs = DEBOUNCE_MS): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void syncNow();
  }, delayMs);
}

/** Runs a sync now. A request that arrives mid-sync runs once more afterwards. */
export function syncNow(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        again = false;
        await syncOnce();
      } while (again);
    } finally {
      running = null;
    }
  })();
  return running;
}

export async function getSyncStatus(): Promise<SyncStatus> {
  const stored = await chrome.storage.local.get(STATUS_KEY);
  return { ...IDLE, ...(stored[STATUS_KEY] as Partial<SyncStatus> | undefined) };
}

/** Forget what was uploaded, so the next sync pulls and sends everything again. */
export async function resetSync(): Promise<void> {
  await clearStores();
  await chrome.storage.local.remove([OWNER_KEY, PULLED_KEY, STATUS_KEY]);
}

async function syncOnce(): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;
  await claim(userId);

  const posts = await readMap<{ shortcode: string; hash: string }>(SYNC_STORE);
  const thumbs = await readMap<ThumbState>(THUMB_STORE);
  try {
    if (!(await isPulled(userId))) await pull(userId, thumbs);

    const records = await db.all();
    const plan = planSync(records, hashes(posts));

    for (const batch of chunks(plan.upserts, UPSERT_BATCH)) {
      // user_id is sent explicitly: a bulk upsert fills missing columns with null, not
      // their default. Row Level Security rejects any value but the caller's own id.
      const rows = batch.map(({ row }) => ({ ...row, user_id: userId }));
      const { error } = await supabase.from('posts').upsert(rows, { onConflict: 'user_id,shortcode' });
      if (error) throw new Error(error.message);
      const done = batch.map(({ row, hash }) => ({ shortcode: row.shortcode, hash }));
      await writeStore(SYNC_STORE, done, []);
      for (const entry of done) posts.set(entry.shortcode, entry);
    }

    for (const batch of chunks(plan.deletes, DELETE_BATCH)) {
      const stored = batch.filter((shortcode) => thumbs.get(shortcode)?.stored);
      if (stored.length) {
        const { error } = await supabase.storage.from(BUCKET).remove(stored.map((s) => thumbPath(userId, s)));
        if (error) throw new Error(error.message);
      }
      const { error } = await supabase.from('posts').delete().in('shortcode', batch);
      if (error) throw new Error(error.message);
      await writeStore(SYNC_STORE, [], batch);
      await writeStore(THUMB_STORE, [], batch);
      for (const shortcode of batch) {
        posts.delete(shortcode);
        thumbs.delete(shortcode);
      }
    }

    await pushLedger(userId);
    const remaining = await copyThumbnails(userId, records, posts, thumbs);
    if (remaining > 0) scheduleSync(NEXT_PASS_MS);

    await setStatus({ lastSyncAt: Date.now(), synced: posts.size, thumbnails: storedCount(thumbs), error: null });
  } catch (err) {
    const message = redact(err instanceof Error ? err.message : String(err));
    await setStatus({
      ...(await getSyncStatus()),
      synced: posts.size,
      thumbnails: storedCount(thumbs),
      error: message,
    });
  }
}

/** Uploads every verdict that is new or changed. Verdicts are never deleted. */
async function pushLedger(userId: string): Promise<void> {
  const synced = hashes(await readMap<{ shortcode: string; hash: string }>(LEDGER_SYNC_STORE));
  const upserts = changed((await ledger.all()).map(toVerdictRow), synced);
  for (const batch of chunks(upserts, UPSERT_BATCH)) {
    const rows = batch.map(({ row }) => ({ ...row, user_id: userId }));
    const { error } = await supabase.from('verdicts').upsert(rows, { onConflict: 'user_id,shortcode' });
    if (error) throw new Error(error.message);
    await writeStore(LEDGER_SYNC_STORE, batch.map(({ row, hash }) => ({ shortcode: row.shortcode, hash })), []);
  }
}

/**
 * Copies one pass of thumbnails into Storage and returns how many are still to do. An
 * image that cannot be fetched (usually an expired URL) is remembered as failed; a lost
 * connection ends the pass and leaves the rest for the next sync.
 */
async function copyThumbnails(
  userId: string,
  records: Parameters<typeof planThumbnails>[0],
  posts: ReadonlyMap<string, { hash: string }>,
  thumbs: Map<string, ThumbState>,
): Promise<number> {
  const todo = planThumbnails(records, hashes(posts), thumbs);
  const pass = todo.slice(0, THUMBS_PER_PASS);
  const tried: ThumbState[] = [];

  for (const [i, { shortcode, url }] of pass.entries()) {
    if (i > 0) await sleep(jitter(THUMB_GAP_MS));
    let image: Blob;
    try {
      image = await shrinkToJpeg(await fetchThumbnail(url));
    } catch (err) {
      if (err instanceof TypeError) break;
      tried.push({ shortcode, stored: false, url });
      continue;
    }
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(thumbPath(userId, shortcode), image, { contentType: 'image/jpeg', upsert: true });
    if (error) throw new Error(error.message);
    tried.push({ shortcode, stored: true, url });
  }

  const stored = tried.filter((t) => t.stored).map((t) => t.shortcode);
  if (stored.length) {
    const { error } = await supabase.from('posts').update({ thumbnail_stored: true }).in('shortcode', stored);
    if (error) throw new Error(error.message);
  }
  await writeStore(THUMB_STORE, tried, []);
  for (const t of tried) thumbs.set(t.shortcode, t);
  return todo.length - tried.length;
}

/**
 * Restores what the account already holds: verdicts into the local ledger (newer wins, so
 * nothing local is overwritten by something older), and which thumbnails are stored.
 * Nothing is indexed as a result: the next indexing run replays these verdicts for free.
 */
async function pull(userId: string, thumbs: Map<string, ThumbState>): Promise<void> {
  const verdicts: ledger.Verdict[] = [];
  for await (const row of pages('verdicts', '*')) {
    const verdict = ledger.parseVerdict(fromVerdictRow(row));
    if (verdict) verdicts.push(verdict);
  }
  await ledger.merge(verdicts);
  // What the server holds, so an unchanged verdict is not uploaded straight back.
  await writeStore(
    LEDGER_SYNC_STORE,
    verdicts.map((v) => ({ shortcode: v.shortcode, hash: digest(toVerdictRow(v)) })),
    [],
  );

  const stored: ThumbState[] = [];
  for await (const row of pages('posts', 'shortcode', true)) {
    stored.push({ shortcode: String(row['shortcode']), stored: true, url: '' });
  }
  await writeStore(THUMB_STORE, stored, []);
  for (const t of stored) thumbs.set(t.shortcode, t);

  await chrome.storage.local.set({ [PULLED_KEY]: userId });
}

/** Every row of `table` the caller can see, a page at a time. */
async function* pages(
  table: 'verdicts' | 'posts',
  columns: string,
  thumbnailStored = false,
): AsyncGenerator<Record<string, unknown>> {
  for (let from = 0; ; from += PAGE) {
    let query = supabase.from(table).select(columns).order('shortcode').range(from, from + PAGE - 1);
    if (thumbnailStored) query = query.eq('thumbnail_stored', true);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    yield* rows;
    if (rows.length < PAGE) return;
  }
}

/** Makes the sync stores describe `userId`, starting over if they described someone else. */
async function claim(userId: string): Promise<void> {
  const stored = await chrome.storage.local.get(OWNER_KEY);
  if (stored[OWNER_KEY] === userId) return;
  await clearStores();
  await chrome.storage.local.remove(PULLED_KEY);
  await chrome.storage.local.set({ [OWNER_KEY]: userId, [STATUS_KEY]: IDLE });
}

async function isPulled(userId: string): Promise<boolean> {
  const stored = await chrome.storage.local.get(PULLED_KEY);
  return stored[PULLED_KEY] === userId;
}

async function setStatus(status: SyncStatus): Promise<void> {
  await chrome.storage.local.set({ [STATUS_KEY]: status });
}

function thumbPath(userId: string, shortcode: string): string {
  return `${userId}/${shortcode}.jpg`;
}

// --- the sync stores ----------------------------------------------------------

async function readMap<T extends { shortcode: string }>(store: string): Promise<Map<string, T>> {
  const conn = await openDb();
  const rows = await new Promise<T[]>((resolve, reject) => {
    const req = conn.transaction(store, 'readonly').objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error ?? new Error('Could not read sync state'));
  });
  return new Map(rows.map((r) => [r.shortcode, r]));
}

/** Writes entries and removes shortcodes in one transaction. */
async function writeStore(store: string, put: readonly object[], removed: readonly string[]): Promise<void> {
  if (!put.length && !removed.length) return;
  const conn = await openDb();
  await new Promise<void>((resolve, reject) => {
    const t = conn.transaction(store, 'readwrite');
    const s = t.objectStore(store);
    for (const shortcode of removed) s.delete(shortcode);
    for (const entry of put) s.put(entry);
    t.oncomplete = () => resolve();
    t.onerror = t.onabort = () => reject(t.error ?? new Error('Could not write sync state'));
  });
}

async function clearStores(): Promise<void> {
  const conn = await openDb();
  const stores = [SYNC_STORE, LEDGER_SYNC_STORE, THUMB_STORE];
  await new Promise<void>((resolve, reject) => {
    const t = conn.transaction(stores, 'readwrite');
    for (const store of stores) t.objectStore(store).clear();
    t.oncomplete = () => resolve();
    t.onerror = t.onabort = () => reject(t.error ?? new Error('Could not clear sync state'));
  });
}

// --- helpers --------------------------------------------------------------------

function hashes(map: ReadonlyMap<string, { hash: string }>): Map<string, string> {
  return new Map([...map].map(([shortcode, { hash }]) => [shortcode, hash]));
}

function storedCount(thumbs: ReadonlyMap<string, ThumbState>): number {
  let n = 0;
  for (const t of thumbs.values()) if (t.stored) n++;
  return n;
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function jitter([min, max]: [number, number]): number {
  return min + Math.random() * (max - min);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Uploads the local library to the signed-in account.
 *
 * Local IndexedDB stays the working copy; the account is a mirror the web app reads. Each
 * sync plans a diff (sync-plan.ts) and applies it in batches, recording each batch in the
 * `sync` store only after the server accepted it, so a worker killed mid-upload resumes
 * from the last confirmed batch on its next wake.
 */

import * as db from './db';
import { openDb, SYNC_STORE } from './db';
import { currentUserId, supabase } from './account';
import { redact } from './providers/index';
import { planSync } from './sync-plan';

export interface SyncStatus {
  lastSyncAt: number | null;
  /** Posts currently mirrored to the account. */
  synced: number;
  error: string | null;
}

const IDLE: SyncStatus = { lastSyncAt: null, synced: 0, error: null };
const STATUS_KEY = 'syncStatus';
/** Which account the `sync` store describes. A different user starts from scratch. */
const OWNER_KEY = 'syncOwner';
const UPSERT_BATCH = 500;
/** Deletes go in the query string, so they are batched smaller. */
const DELETE_BATCH = 100;
/** Capture arrives in bursts while you scroll; one upload per burst is enough. */
const DEBOUNCE_MS = 3_000;

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

/** Forget what was uploaded, so the next sync sends everything again. */
export async function resetSync(): Promise<void> {
  await writeSynced([], null);
  await chrome.storage.local.remove([OWNER_KEY, STATUS_KEY]);
}

async function syncOnce(): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;

  const synced = await readSynced(userId);
  try {
    const plan = planSync(await db.all(), synced);

    for (const batch of chunks(plan.upserts, UPSERT_BATCH)) {
      // user_id is sent explicitly: a bulk upsert fills missing columns with null, not
      // their default. Row Level Security rejects any value but the caller's own id.
      const rows = batch.map(({ row }) => ({ ...row, user_id: userId }));
      const { error } = await supabase.from('posts').upsert(rows, { onConflict: 'user_id,shortcode' });
      if (error) throw new Error(error.message);
      const done = batch.map(({ row, hash }) => [row.shortcode, hash] as const);
      await writeSynced(done, []);
      for (const [shortcode, hash] of done) synced.set(shortcode, hash);
    }

    for (const batch of chunks(plan.deletes, DELETE_BATCH)) {
      const { error } = await supabase.from('posts').delete().in('shortcode', batch);
      if (error) throw new Error(error.message);
      await writeSynced([], batch);
      for (const shortcode of batch) synced.delete(shortcode);
    }

    await setStatus({ lastSyncAt: Date.now(), synced: synced.size, error: null });
  } catch (err) {
    const message = redact(err instanceof Error ? err.message : String(err));
    await setStatus({ ...(await getSyncStatus()), synced: synced.size, error: message });
  }
}

async function setStatus(status: SyncStatus): Promise<void> {
  await chrome.storage.local.set({ [STATUS_KEY]: status });
}

/** The digests last uploaded, after making sure they belong to `userId`. */
async function readSynced(userId: string): Promise<Map<string, string>> {
  const stored = await chrome.storage.local.get(OWNER_KEY);
  if (stored[OWNER_KEY] !== userId) {
    await writeSynced([], null);
    await chrome.storage.local.set({ [OWNER_KEY]: userId, [STATUS_KEY]: IDLE });
    return new Map();
  }

  const conn = await openDb();
  const rows = await new Promise<{ shortcode: string; hash: string }[]>((resolve, reject) => {
    const req = conn.transaction(SYNC_STORE, 'readonly').objectStore(SYNC_STORE).getAll();
    req.onsuccess = () => resolve(req.result as { shortcode: string; hash: string }[]);
    req.onerror = () => reject(req.error ?? new Error('Could not read sync state'));
  });
  return new Map(rows.map((r) => [r.shortcode, r.hash]));
}

/** Records uploaded digests and removes deleted ones. `removed: null` clears the store. */
async function writeSynced(
  uploaded: readonly (readonly [string, string])[],
  removed: readonly string[] | null,
): Promise<void> {
  const conn = await openDb();
  await new Promise<void>((resolve, reject) => {
    const t = conn.transaction(SYNC_STORE, 'readwrite');
    const store = t.objectStore(SYNC_STORE);
    if (removed === null) store.clear();
    else for (const shortcode of removed) store.delete(shortcode);
    for (const [shortcode, hash] of uploaded) store.put({ shortcode, hash });
    t.oncomplete = () => resolve();
    t.onerror = t.onabort = () => reject(t.error ?? new Error('Could not write sync state'));
  });
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * The ledger: every verdict this browser has, which is work that was paid for.
 *
 * The two durable content stores, `posts` and this one, look similar and are governed by
 * opposite rules, which is the whole point of separating them. A post record is a *view
 * of what is currently saved* — free to rebuild, because scrolling the grid again
 * reproduces it exactly. A verdict is *work that was bought* — a summary and a category
 * that cost tokens, and that no amount of scrolling brings back. So `prune()` may forget
 * a post you unsaved, and nothing in db.ts may delete from here (invariant 4).
 *
 * Indexing runs on the server now. This store holds what an older build bought with the
 * user's own key, and every verdict the account has filed since, which sync.ts pulls down
 * with `merge` so the posts it uploads never carry an older category over a newer one.
 * Each verdict still records the hash of the exact text the model was shown and the
 * taxonomy it was filed against, because the account's ledger keys on them.
 */

import { LEDGER_VERSION } from '@saved-index/shared/filing';
import type { PostRecord } from '../types';
import { LEDGER_STORE, openDb } from './db';

export interface Verdict {
  /** Primary key, shared with the post it describes. */
  shortcode: string;
  category: string | null;
  subcategory: string | null;
  tags: string[];
  summary: string | null;
  /** "rules", "skipped", or the model id that was billed. */
  modelUsed: string;
  categorizedAt: number;
  /**
   * Digest of the exact text the model was shown. A caption edited on Instagram, or an
   * alt text that arrives on a later capture, changes this and re-opens the question;
   * anything else leaves it alone.
   */
  inputHash: string;
  /** Which vocabulary this verdict was filed against. See taxonomy.ts. */
  taxonomyHash: string;
  /** Only local-rule verdicts depend on this; paid model verdicts survive a rule tweak. */
  rulesHash: string;
  ledgerVersion: number;
}

/** Apply a stored verdict to a post. The post's own captured fields are untouched. */
export function applyVerdict(post: PostRecord, v: Verdict): PostRecord {
  return {
    ...post,
    category: v.category,
    subcategory: v.subcategory,
    tags: v.tags,
    summary: v.summary,
    categorizedAt: v.categorizedAt,
    modelUsed: v.modelUsed,
  };
}

// --- storage ----------------------------------------------------------------
//
// Held resident, and the promise is cached rather than the map, for the reason set out in
// db.ts: a verdict written into an orphaned map is one `merge` cannot see.
let cache: Promise<Map<string, Verdict>> | null = null;

function resident(): Promise<Map<string, Verdict>> {
  cache ??= (async () => {
    const db = await openDb();
    const rows = await new Promise<Verdict[]>((resolve, reject) => {
      const req = db.transaction(LEDGER_STORE, 'readonly').objectStore(LEDGER_STORE).getAll();
      req.onsuccess = () => resolve(req.result as Verdict[]);
      req.onerror = () => reject(req.error ?? new Error('ledger read failed'));
    });
    const map = new Map<string, Verdict>();
    for (const v of rows) map.set(v.shortcode, v);
    return map;
  })().catch((err: unknown) => {
    cache = null;
    throw err;
  });
  return cache;
}

async function putMany(verdicts: Verdict[]): Promise<void> {
  if (!verdicts.length) return;
  const db = await openDb();
  const live = await resident();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(LEDGER_STORE, 'readwrite');
    const store = t.objectStore(LEDGER_STORE);
    for (const v of verdicts) store.put(v);
    t.oncomplete = () => {
      for (const v of verdicts) live.set(v.shortcode, v);
      resolve();
    };
    t.onerror = t.onabort = () => {
      cache = null;
      reject(t.error ?? new Error('ledger write failed'));
    };
  });
}

/**
 * Erases every paid summary. Only Clear Library calls this, after the user pressed it
 * twice and was told the summaries go too. Nothing else may: see invariant 4.
 */
export async function clearAll(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(LEDGER_STORE, 'readwrite');
    t.objectStore(LEDGER_STORE).clear();
    t.oncomplete = () => resolve();
    t.onerror = t.onabort = () => reject(t.error ?? new Error('ledger clear failed'));
  });
  cache = null;
}

/** Stores each verdict that is newer than the one on file. Returns how many were stored. */
export async function merge(verdicts: Verdict[]): Promise<number> {
  const live = await resident();
  const fresh = verdicts.filter((v) => {
    const existing = live.get(v.shortcode);
    return !existing || existing.categorizedAt < v.categorizedAt;
  });
  await putMany(fresh);
  return fresh.length;
}

/** Every verdict on file. */
export async function all(): Promise<Verdict[]> {
  return [...(await resident()).values()];
}

const MAX_TEXT = 2000;

/** A verdict from the account, checked field by field; null if unusable. */
export function parseVerdict(raw: unknown): Verdict | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const v = raw as Record<string, unknown>;

  const shortcode = typeof v['shortcode'] === 'string' ? v['shortcode'] : null;
  if (!shortcode || shortcode.length > 64) return null;

  const categorizedAt = typeof v['categorizedAt'] === 'number' ? v['categorizedAt'] : null;
  if (categorizedAt === null || !Number.isFinite(categorizedAt)) return null;

  return {
    shortcode,
    category: str(v['category'], MAX_TEXT),
    subcategory: str(v['subcategory'], MAX_TEXT),
    tags: Array.isArray(v['tags'])
      ? v['tags'].slice(0, 8).map((t) => String(t).slice(0, 64))
      : [],
    summary: str(v['summary'], MAX_TEXT),
    modelUsed: str(v['modelUsed'], 128) ?? 'imported',
    categorizedAt,
    inputHash: str(v['inputHash'], 64) ?? '',
    taxonomyHash: str(v['taxonomyHash'], 64) ?? '',
    rulesHash: str(v['rulesHash'], 64) ?? '',
    ledgerVersion: typeof v['ledgerVersion'] === 'number' ? v['ledgerVersion'] : LEDGER_VERSION,
  };
}

function str(value: unknown, max: number): string | null {
  return typeof value === 'string' ? value.slice(0, max) : null;
}

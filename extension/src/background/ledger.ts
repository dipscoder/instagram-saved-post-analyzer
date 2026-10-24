/**
 * The ledger: everything the user has already paid a model to say.
 *
 * The two durable content stores, `posts` and this one, look similar and are governed by
 * opposite rules, which is the whole point of separating them (`indexQueue` is transient
 * run state). A post record is a *view of what is currently
 * saved* — free to rebuild, because scrolling the grid again reproduces it exactly. A
 * verdict is *work that was bought* — a summary and a category that cost tokens, and that
 * no amount of scrolling brings back. Storing the second inside the first meant every
 * operation that legitimately wanted to discard the view discarded the purchase with it:
 *
 *   - `prune()` hard-deleted records for posts you had unsaved. Instagram's save button is
 *     a toggle; re-saving something billed for it a second time.
 *   - `reindex` nulled every categorisation field and re-ran the whole library, which is
 *     the honest behaviour when the *taxonomy* changed and pure waste when it hadn't.
 *   - A cleared profile, an evicted database, or loading the unpacked extension from a
 *     different folder — which changes the extension id, and therefore the origin the
 *     database is keyed to — started from zero.
 *
 * So verdicts live here, in their own store, and nothing in db.ts may delete from it.
 *
 * **Staleness is a question this store can answer.** Each verdict records a hash of the
 * exact text that was sent to the model and the hash of the taxonomy it was filed against;
 * free rule verdicts additionally identify the rule strategy that produced them.
 * "Is this still valid?" is then a comparison rather than a guess, which is what makes a
 * re-index cost only the posts that actually changed. Without those two fields the only
 * available answers are "re-spend everything" and "serve an answer from a prompt that no
 * longer exists", and this file exists to avoid choosing between them.
 *
 * The store itself is local. Portability across machines is the account, when signed in
 * (sync.ts mirrors every verdict and pulls them back with `merge`), or a file: `exportAll`
 * writes one, `importAll` reads one, and the popup does both without asking for a single
 * extra permission, because an extension page can hand the browser a Blob directly.
 */

import { hashText } from '@saved-index/shared/hash';
import { RULES_HASH, TAXONOMY_HASH } from '@saved-index/shared/taxonomy';
import type { PostRecord } from '../types';
import { LEDGER_STORE, openDb } from './db';

/** Bumped only for a change to this record's own shape. */
export const LEDGER_VERSION = 2;

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

/**
 * A verdict is worth reusing when it was produced from the same input against the same
 * taxonomy. Anything else and we genuinely do not know whether the answer still holds,
 * so we pay for a new one rather than serve a stale one confidently.
 *
 * `modelUsed: 'skipped'` is deliberately *not* reusable. It records that a thumbnail
 * could not be fetched, which is usually an expired CDN URL rather than a fact about the
 * post — treating it as a permanent verdict is how a post gets stuck as Uncategorized
 * forever. It is still stored, so the queue does not spin on it within a run.
 */
export function isFresh(v: Verdict | undefined, inputHash: string): v is Verdict {
  return (
    v !== undefined &&
    v.modelUsed !== 'skipped' &&
    v.inputHash === inputHash &&
    v.taxonomyHash === TAXONOMY_HASH &&
    (v.modelUsed !== 'rules' || v.rulesHash === RULES_HASH)
  );
}

/** The digest of one post's model-visible text. `signature` comes from filing.ts. */
export function inputHash(signature: string): string {
  return hashText(signature);
}

export function verdictFrom(post: PostRecord, signature: string): Verdict {
  return {
    shortcode: post.shortcode,
    category: post.category,
    subcategory: post.subcategory,
    tags: post.tags,
    summary: post.summary,
    modelUsed: post.modelUsed ?? 'unknown',
    categorizedAt: post.categorizedAt ?? Date.now(),
    inputHash: inputHash(signature),
    taxonomyHash: TAXONOMY_HASH,
    rulesHash: RULES_HASH,
    ledgerVersion: LEDGER_VERSION,
  };
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
// Held resident for the same reason the post cache is: the hydrate step asks about every
// pending post at once, and 500 individual `get` round-trips per round is the kind of cost
// that only shows up on the libraries big enough to care about.

// The promise is cached rather than the map, for the reason set out in db.ts — and here
// the cost of getting it wrong is measured in dollars: a verdict written into an orphaned
// map is a verdict `get` cannot find, so the post goes back to the model and is paid for
// a second time.
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

/** One resident-cache lookup for a batch, rather than hundreds of awaited microtasks. */
export async function getMany(shortcodes: string[]): Promise<Map<string, Verdict>> {
  const live = await resident();
  const out = new Map<string, Verdict>();
  for (const shortcode of shortcodes) {
    const verdict = live.get(shortcode);
    if (verdict) out.set(shortcode, verdict);
  }
  return out;
}

export async function countStale(
  entries: { shortcode: string; inputHash: string }[],
): Promise<number> {
  const live = await resident();
  let stale = 0;
  for (const entry of entries) {
    if (!isFresh(live.get(entry.shortcode), entry.inputHash)) stale++;
  }
  return stale;
}

export async function count(): Promise<number> {
  return (await resident()).size;
}

export async function putMany(verdicts: Verdict[]): Promise<void> {
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

// --- portability ------------------------------------------------------------

export interface LedgerFile {
  kind: 'saved-index-ledger';
  ledgerVersion: number;
  taxonomyHash: string;
  exportedAt: number;
  verdicts: Verdict[];
}

export async function exportAll(): Promise<LedgerFile> {
  return {
    kind: 'saved-index-ledger',
    ledgerVersion: LEDGER_VERSION,
    taxonomyHash: TAXONOMY_HASH,
    exportedAt: Date.now(),
    verdicts: await all(),
  };
}

/**
 * Merge a ledger file in. Newer wins per shortcode, so importing the same file twice is a
 * no-op and importing two machines' files into each other converges — there is no
 * ordering the user has to get right.
 *
 * Every field is checked rather than trusted. The file is user-supplied, it may have been
 * edited or truncated, and a malformed verdict here would surface later as a corrupt row
 * in the library with no obvious cause.
 */
export async function importAll(raw: unknown): Promise<{ imported: number; skipped: number }> {
  const file = raw as Partial<LedgerFile> | null;
  if (!file || file.kind !== 'saved-index-ledger' || !Array.isArray(file.verdicts)) {
    throw new Error('That file is not a Saved Index ledger export.');
  }
  const valid = file.verdicts.map(parseVerdict).filter((v): v is Verdict => v !== null);
  const imported = await merge(valid);
  return { imported, skipped: file.verdicts.length - imported };
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

/** A verdict from a file or the account, checked field by field; null if unusable. */
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

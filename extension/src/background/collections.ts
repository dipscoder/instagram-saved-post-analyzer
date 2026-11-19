/**
 * Names of the user's Instagram collections, by id.
 *
 * Posts carry only collection ids; the names live here, written when a collection is
 * browsed. Instagram puts the name in the collection's URL, which is all we know of it,
 * so a renamed collection shows its new name the next time it is opened.
 */

import type { SavedCollectionRef } from '../messaging';

const KEY = 'collectionNames';
const MAX_NAME = 100;

/**
 * The collection a capture message claims, if it is well formed. It is built in the
 * content script from the page's URL, which Instagram's own code can change, so it is
 * checked like any other page-influenced value.
 */
export function validCollection(value: unknown): SavedCollectionRef | null {
  if (!value || typeof value !== 'object') return null;
  const { id, name } = value as Record<string, unknown>;
  if (typeof id !== 'string' || !/^[0-9]{1,30}$/.test(id)) return null;
  if (typeof name !== 'string') return null;
  const clean = name.replace(/[\u0000-\u001f]/g, '').trim().slice(0, MAX_NAME);
  return { id, name: clean || 'Collection' };
}

export async function collectionNames(): Promise<Record<string, string>> {
  const stored = await chrome.storage.local.get(KEY);
  return (stored[KEY] as Record<string, string> | undefined) ?? {};
}

/** Forgets every collection name, for a clean slate. */
export async function forgetCollections(): Promise<void> {
  await chrome.storage.local.remove(KEY);
}

/** Records a collection's current name. Writes only when it changed. */
export async function rememberCollection(c: SavedCollectionRef): Promise<boolean> {
  const names = await collectionNames();
  if (names[c.id] === c.name) return false;
  await chrome.storage.local.set({ [KEY]: { ...names, [c.id]: c.name } });
  return true;
}

/** Collections that hold posts, alphabetically, for the library's sidebar. */
export function listCollections(
  counts: Record<string, number>,
  names: Record<string, string>,
): (SavedCollectionRef & { count: number })[] {
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([id, count]) => ({ id, name: names[id] ?? 'Collection', count }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/**
 * The pure half of the `search` function: what a request may ask for. No I/O, so
 * `npm run verify` checks it in plain Node.
 */

import { cleanQuery } from '@saved-index/shared/embedding';
import { TAXONOMY } from '@saved-index/shared/taxonomy';

export interface Search {
  query: string;
  category: string | null;
  collection: string | null;
  needsLook: boolean;
}

export class BadSearch extends Error {}

const CATEGORIES = new Set(TAXONOMY.map((c) => c.name));

export function parseSearch(body: unknown): Search {
  const raw = (body ?? {}) as Record<string, unknown>;
  const query = cleanQuery(raw['query']);
  if (query.length < 2) throw new BadSearch('Type at least two characters.');

  const category = raw['category'] ?? null;
  if (category !== null && (typeof category !== 'string' || !CATEGORIES.has(category))) {
    throw new BadSearch('Unknown category.');
  }
  const collection = raw['collection'] ?? null;
  if (collection !== null && (typeof collection !== 'string' || !/^[0-9]{1,30}$/.test(collection))) {
    throw new BadSearch('Unknown collection.');
  }
  return { query, category, collection, needsLook: raw['needsLook'] === true };
}

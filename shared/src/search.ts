/**
 * Turns what someone types into the web app's search box into PostgREST filters.
 *
 * Every term must match somewhere (AND across terms, OR across columns), the same rule the
 * extension's own search uses. Terms are cut down to letters and digits first, so nothing a
 * user types can change the filter's structure: PostgREST gives `,` `.` `(` `)` `:` and `*`
 * meaning inside an `or=(...)` value, and `%` `_` are wildcards in ILIKE.
 */

/** Columns matched by substring. */
export const TEXT_COLUMNS = [
  'caption',
  'handle',
  'summary',
  'category',
  'subcategory',
  'alt_text',
  'audio_track_name',
] as const;

/** Array columns matched by a whole element. */
export const ARRAY_COLUMNS = ['tags', 'hashtags'] as const;

const MAX_TERMS = 6;
const MAX_TERM_LENGTH = 40;

/** Lower-cased words of at least two letters or digits, de-duplicated, at most six. */
export function searchTerms(query: string): string[] {
  const words = query
    .toLowerCase()
    .normalize('NFKC')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 2)
    .map((w) => w.slice(0, MAX_TERM_LENGTH));
  return [...new Set(words)].slice(0, MAX_TERMS);
}

/** One `.or()` filter per term: any column may hold it. */
export function searchFilters(query: string): string[] {
  return searchTerms(query).map((term) =>
    [
      ...TEXT_COLUMNS.map((c) => `${c}.ilike.*${term}*`),
      ...ARRAY_COLUMNS.map((c) => `${c}.cs.{${term}}`),
    ].join(','),
  );
}

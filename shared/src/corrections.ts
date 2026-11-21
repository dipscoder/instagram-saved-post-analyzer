/**
 * Fixing a wrong category, and turning those fixes into eval cases. Pure; the web app
 * saves a fix with the `correct_category` RPC and `npm run verify` checks these.
 *
 * A fix is the most useful label there is: it is a post the pipeline actually got wrong,
 * labeled by the only person who knows where they would look for it.
 */

import { CATEGORY_NAMES } from './taxonomy';

/** What a post can be moved to: any category, or Unknown (null). */
export const CORRECTION_TARGETS: (string | null)[] = [...CATEGORY_NAMES, null];

export function isCorrectionTarget(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && CATEGORY_NAMES.includes(value));
}

/** One row of `public.corrections`. */
export interface CorrectionRow {
  shortcode: string;
  from_category: string | null;
  to_category: string | null;
  handle: string;
  caption: string;
  hashtags: string[];
}

/** A labeled post in the shape of supabase/eval/labeled.json. */
export interface EvalCase {
  id: string;
  handle: string;
  caption: string;
  hashtags: string[];
  expected: string | null;
  note?: string;
}

/**
 * The fixes as eval cases, ready to save as a file and run with
 * `npm run eval -- --with <file>`. A fix to a category that no longer exists is left out.
 */
export function evalCases(rows: CorrectionRow[]): { about: string; posts: EvalCase[] } {
  const posts = rows
    .filter((r) => isCorrectionTarget(r.to_category))
    .map((r) => ({
      id: `you-${r.shortcode}`,
      handle: r.handle.replace(/^@/, ''),
      caption: r.caption,
      hashtags: r.hashtags ?? [],
      expected: r.to_category,
      note: `you moved it from ${r.from_category ?? 'Unknown'}`,
    }));
  return {
    about: 'Categories you fixed by hand in Saved Index. Private: these are your own saved posts.',
    posts,
  };
}

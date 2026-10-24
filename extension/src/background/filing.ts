/**
 * The pure half of filing a post: what the model is shown, and how its answer becomes a
 * record. Kept apart from categorize.ts so `npm run verify` can check it without a
 * service worker.
 */

import type { ModelResult } from '@saved-index/shared/filing';
import { normalizeCategory, normalizeSubcategory } from '@saved-index/shared/taxonomy';
import type { PostRecord } from '../types';

const CAPTION_CHAR_BUDGET = 400;

/**
 * Everything about a post that reaches the model, minus the batch position.
 *
 * The ledger hashes exactly this, so "has anything changed since we paid for the answer?"
 * compares the bytes that were actually sent. The id is excluded deliberately: it is a
 * position within one batch, and hashing it would make an identical post look different
 * for no reason other than where it landed in a list.
 */
export function signature(p: PostRecord): string {
  const parts = [p.handle];
  if (p.isVideo) parts.push(p.durationSec ? `video ${Math.round(p.durationSec)}s` : 'video');
  if (p.audioTrackName) parts.push(`audio: ${p.audioTrackName}`);

  const lines = [parts.join(' | ')];
  const caption = p.caption.replace(/\s+/g, ' ').trim().slice(0, CAPTION_CHAR_BUDGET);
  lines.push(`caption: ${caption || '(none)'}`);
  if (p.altText) lines.push(`alt text: ${p.altText.replace(/\s+/g, ' ').slice(0, 200)}`);
  if (p.hashtags.length) lines.push(`hashtags: ${p.hashtags.slice(0, 12).join(' ')}`);
  return lines.join('\n');
}

export function unclassifiable(post: PostRecord): PostRecord {
  return {
    ...post,
    category: null,
    subcategory: null,
    tags: [],
    summary: post.altText?.replace(/\s+/g, ' ').slice(0, 160) ?? null,
    categorizedAt: Date.now(),
    modelUsed: 'skipped',
  };
}

/** Enough to file from text alone. Anything else falls through to the thumbnail. */
export function hasTextSignal(p: PostRecord): boolean {
  return (
    p.caption.trim().length >= 15 ||
    p.hashtags.length >= 2 ||
    (p.altText ?? '').trim().length >= 25
  );
}

export function applyResult(post: PostRecord, r: ModelResult, model: string): PostRecord {
  // A low-confidence answer is worse than no answer: it buries the post under a
  // category you will never think to look in. Keep the summary, drop the guess — the
  // post shows up under Uncategorized and is still searchable.
  const confidence = text(r.confidence).toLowerCase();
  const confident = confidence === 'high' || confidence === 'medium';

  // Every field is coerced rather than trusted. `ModelResult` is a TypeScript shape over
  // `JSON.parse` output and guarantees nothing at runtime: `tags: "food, recipe"` used to
  // reach `.map` on a string, throw, escape the pool, and end the whole run with a
  // TypeError in the popup — after the batch had already been paid for.
  const category = confident ? normalizeCategory(text(r.category)) : null;

  return {
    ...post,
    category,
    subcategory: normalizeSubcategory(category, text(r.subcategory)),
    tags: [
      ...new Set(
        (Array.isArray(r.tags) ? r.tags : [])
          .map((t) => String(t).trim().toLowerCase().slice(0, 48))
          .filter(Boolean),
      ),
    ].slice(0, 4),
    summary: (text(r.summary) || firstLine(post.caption) || '').replace(/\s+/g, ' ').slice(0, 160) || null,
    categorizedAt: Date.now(),
    modelUsed: model,
  };
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function firstLine(caption: string): string {
  const line = caption.split('\n').find((l) => l.trim().length > 0) ?? '';
  return line.trim().slice(0, 120);
}

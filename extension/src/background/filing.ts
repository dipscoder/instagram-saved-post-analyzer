/**
 * The pure half of filing a post: what the model is shown, and how its answer becomes a
 * record. Kept apart from categorize.ts so `npm run verify` can check it without a
 * service worker.
 */

import { filedFromResult, type ModelResult } from '@saved-index/shared/filing';
import type { PostRecord } from '../types';

/** Shared with the server so both file a post from the same bytes. See shared/src/filing.ts. */
export { firstLine, hasTextSignal, signature } from '@saved-index/shared/filing';

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

export function applyResult(post: PostRecord, r: ModelResult, model: string): PostRecord {
  return { ...post, ...filedFromResult(post, r), categorizedAt: Date.now(), modelUsed: model };
}

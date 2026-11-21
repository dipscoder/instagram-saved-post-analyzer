import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from '@saved-index/shared/embedding';
import { CATEGORY_NAMES } from '@saved-index/shared/taxonomy';

/**
 * What the "How indexing works" page says about the server. Kept here rather than
 * imported from the Edge Function, which the web app does not bundle; `npm run verify`
 * checks that the two agree, so the page cannot quietly go stale.
 */
export const PIPELINE = {
  decisionsModel: 'gpt-6-luna',
  summaryModel: 'gpt-5.6-luna',
  embeddingModel: EMBEDDING_MODEL,
  embeddingDimensions: EMBEDDING_DIMENSIONS,
  transcribeModel: 'gpt-transcribe',
  /** Below this probability a category is a guess, and the post is filed as Unknown. */
  minProbability: 0.6,
  categories: CATEGORY_NAMES.length,
  batchSize: 25,
  /** USD per million tokens (per minute for transcripts), list price. */
  price: { decisionsInput: 0.1, summaryInput: 0.2, summaryOutput: 1.2, embeddings: 0.02, transcribePerMinute: 0.0045 },
} as const;

/**
 * Embeddings for search by meaning. Pure: what text a post is embedded from, how a reply
 * is read, and what it costs. The server makes the calls; `npm run verify` checks these.
 *
 * A post is embedded from what it is *about* (its summary, category and tags) followed by
 * its own words, so "something to cook on a weeknight" finds a post summarised as
 * "sheet-pan harissa chicken" even when the caption never says "weeknight".
 */

export const EMBEDDING_MODEL = 'text-embedding-3-small';
/**
 * Shortened from 1,536. The model is trained so the first dimensions carry the most
 * meaning; 512 keeps nearly all of the search quality at a third of the storage.
 */
export const EMBEDDING_DIMENSIONS = 512;
/** USD per million input tokens, list price. */
const PRICE_PER_MILLION = 0.02;
/** About 600 tokens: plenty for a post, and a hard ceiling on what one can cost. */
const MAX_CHARS = 2_400;
/** A reel's opening says what it is about; the whole of it would crowd out the rest. */
const TRANSCRIPT_CHARS = 1_000;
/** The most embedding one post can cost, with room to spare: MAX_CHARS is ~600 tokens. */
export const EMBED_QUOTE_USD_PER_POST = 0.00002;
/** Queries are short; anything longer is not a search. */
export const MAX_QUERY_CHARS = 200;

export interface EmbeddingFields {
  handle: string | null;
  caption: string | null;
  hashtags: string[] | null;
  alt_text: string | null;
  audio_track_name: string | null;
  category: string | null;
  subcategory: string | null;
  tags: string[] | null;
  summary: string | null;
  /** A reel's transcript; optional so posts from before transcription embed as they did. */
  transcript?: string | null;
}

/** The text a post is embedded from: what it is about first, then its own words. */
export function embeddingText(p: EmbeddingFields): string {
  const about = [
    p.summary,
    p.category && p.category !== 'Uncategorized' ? p.category : null,
    p.subcategory,
    p.tags?.length ? p.tags.join(', ') : null,
  ];
  const own = [
    p.caption,
    p.transcript ? `said: ${p.transcript.slice(0, TRANSCRIPT_CHARS)}` : null,
    p.hashtags?.length ? p.hashtags.map((h) => `#${h}`).join(' ') : null,
    p.alt_text,
    p.audio_track_name ? `audio: ${p.audio_track_name}` : null,
    p.handle ? `@${p.handle.replace(/^@/, '')}` : null,
  ];
  return [...about, ...own]
    .filter((s): s is string => typeof s === 'string' && s.trim() !== '')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .join('\n')
    .slice(0, MAX_CHARS);
}

export function embeddingsBody(inputs: string[]): object {
  return { model: EMBEDDING_MODEL, input: inputs, dimensions: EMBEDDING_DIMENSIONS, encoding_format: 'float' };
}

/**
 * The vectors in input order, or null when the reply is not one well-formed vector per
 * input. A partial answer is discarded rather than risk pairing a vector with the wrong
 * post.
 */
export function readEmbeddings(reply: unknown, count: number): number[][] | null {
  const data = (reply as { data?: unknown } | null)?.data;
  if (!Array.isArray(data) || data.length !== count) return null;
  const out: number[][] = new Array(count);
  for (const item of data as { index?: unknown; embedding?: unknown }[]) {
    const index = Number(item.index);
    const vector = item.embedding;
    if (!Number.isInteger(index) || index < 0 || index >= count || out[index]) return null;
    if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSIONS) return null;
    if (!vector.every((x) => typeof x === 'number' && Number.isFinite(x))) return null;
    out[index] = vector as number[];
  }
  return out;
}

export function embeddingCostUsd(reply: unknown): number {
  const tokens = Number((reply as { usage?: { total_tokens?: unknown } } | null)?.usage?.total_tokens) || 0;
  return (tokens * PRICE_PER_MILLION) / 1_000_000;
}

/** pgvector's text form, which PostgREST passes straight into a `vector` column. */
export function vectorLiteral(v: number[]): string {
  return `[${v.map((x) => Number(x.toFixed(6))).join(',')}]`;
}

/** A search box entry made safe to embed and to hand to Postgres full-text search. */
export function cleanQuery(query: unknown): string {
  if (typeof query !== 'string') return '';
  return query
    .normalize('NFKC')
    .replace(/[\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_QUERY_CHARS);
}

/**
 * POST /functions/v1/sort { shortcodes, refile? }: sorts up to 25 of the caller's own posts on
 * the server and saves the verdicts to the account, so the web app can sort without the
 * extension. Paid from the project's OpenAI key, under the same daily cap as `analyze`.
 *
 * Everything runs with the caller's session, so Row Level Security limits every read and
 * write to their own rows. The server reads the posts itself and skips any already
 * sorted, so a repeated request costs nothing.
 *
 * Reels are transcribed first (up to four a request), so they are filed and searched by
 * what is said in them. Each post filed here, and any filed earlier but not yet
 * searchable by meaning, is then embedded for hybrid search.
 *
 * `refile: true` is Index again, from a post's panel: one post, filed by the model even if
 * it was filed before or given up on. The web app quotes it and asks first.
 *
 *   200 { sorted, embedded, transcribed, unreadable, failed, usd }
 *   400 bad request · 401 not signed in · 402 daily limit reached
 *   429 OpenAI is rate limiting (retry) · 502 OpenAI or the database failed · 500 not configured
 */

import { embeddingCostUsd, embeddingsBody, embeddingText, readEmbeddings, vectorLiteral } from '@saved-index/shared/embedding';
import type { Filed, ModelResult } from '@saved-index/shared/filing';
import { isInstagramVideoUrl, tooLong, transcribeCostUsd } from '@saved-index/shared/transcript';
import {
  combine,
  costUsd,
  decisionsBody,
  MODEL_LABEL,
  readDecisions,
  readSummaries,
  summaryBody,
  usageOf,
  type AnalyzeRequest,
} from '../analyze/decide';
import { callerOf, capReached, error, openai, recordUsage, spentToday, transcribe, type Caller, type Transcribed } from '../_shared/server';
import {
  BadSortRequest,
  embeddingFields,
  filedFrom,
  hasAnyText,
  modelText,
  parseSortRequest,
  pickTranscribe,
  planSort,
  SORT_COLUMNS,
  thumbnailPath,
  verdictRow,
  type SortRequest,
  type SortRow,
} from './plan';

export interface Env {
  supabaseUrl: string;
  openaiKey: string;
  capUsd: number;
}

/** The largest stored thumbnail the function will send on: ten times a normal one. */
const MAX_THUMBNAIL_BYTES = 512 * 1024;
/** OpenAI failing on a reel this many runs in a row: file it without its words. */
const MAX_TRANSCRIBE_ATTEMPTS = 3;

export async function handle(req: Request, env: Env): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  const res = await route(req, env);
  for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
  return res;
}

async function route(req: Request, env: Env): Promise<Response> {
  if (req.method !== 'POST') return error(405, 'Use POST.');
  if (!env.openaiKey || !env.supabaseUrl) return error(500, 'Sorting is not set up on the server yet.');

  const who = await callerOf(req, env.supabaseUrl);
  if (!who) return error(401, 'Sign in first.');
  const { caller, userId } = who;

  let request: SortRequest;
  try {
    request = parseSortRequest(await req.json());
  } catch (err) {
    return error(400, err instanceof BadSortRequest ? err.message : 'The request is not valid JSON.');
  }

  const spent = await spentToday(env.supabaseUrl, caller);
  if (spent === null) return error(502, 'Could not read today’s usage. Try again shortly.');
  if (spent >= env.capUsd) return error(402, capReached(env.capUsd));

  const { refile } = request;
  const rows = await readPosts(env.supabaseUrl, caller, request.shortcodes);
  if (!rows) return error(502, 'Could not read your posts. Try again shortly.');

  // Transcripts first: they change how a reel is filed, and what it is embedded from.
  const reels = await transcribeReels(env, caller, pickTranscribe(rows, { refile }));
  const plan = planSort(rows, { refile });

  const at = new Date();
  const verdicts = plan.ruled.map(({ row, filed }) => verdictRow(row, filed, 'rules', at));
  // Everything filed in this request, plus anything filed earlier but not yet embedded.
  const toEmbed: { row: SortRow; filed?: Filed }[] = [...plan.ruled, ...plan.embedOnly.map((row) => ({ row }))];
  // Recorded on the posts, so a post that cannot be indexed says why and is not retried forever.
  const failures: Failure[] = [...reels.failures];
  let usd = reels.usd;
  let rateLimited = reels.rateLimited;
  const billed = reels.count + plan.text.length + plan.vision.length;

  const file = async (batch: SortRow[], image?: string): Promise<void> => {
    const body: AnalyzeRequest = { posts: batch.map((row, id) => ({ id, text: modelText(row) })), image };
    // Both calls are billed whether or not the other succeeds; one answering is enough.
    const [decisions, summaries] = await Promise.all([
      openai('decisions', decisionsBody(body), env.openaiKey),
      openai('responses', summaryBody(body), env.openaiKey),
    ]);
    usd += costUsd(usageOf(decisions.reply), usageOf(summaries.reply));
    const busy = decisions.status === 429 || summaries.status === 429;
    if (busy) rateLimited = true;
    const results = new Map<number, ModelResult>(
      combine(body, readDecisions(decisions.reply), readSummaries(summaries.reply)).map((r) => [r.id, r]),
    );
    const reason = decisions.reply === null && summaries.reply === null ? 'openai_error' : 'no_answer';
    batch.forEach((row, id) => {
      const result = results.get(id);
      // A rate limit is ours, not the post's: it is retried without counting against it.
      if (!result) return void (busy ? failures.push({ row, reason, counted: false }) : failures.push({ row, reason }));
      const filed = filedFrom(row, result);
      verdicts.push(verdictRow(row, filed, MODEL_LABEL, at));
      toEmbed.push({ row, filed });
    });
  };

  const textBatch = [...plan.text];
  const pictures = await Promise.all(plan.vision.map((row) => thumbnail(env.supabaseUrl, caller, thumbnailPath(userId, row))));
  const jobs: Promise<void>[] = [];
  plan.vision.forEach((row, i) => {
    const image = pictures[i];
    if (image) jobs.push(file([row], image));
    // The picture could not be read this time: file from whatever words there are.
    else if (hasAnyText(row)) textBatch.push(row);
    else failures.push({ row, reason: 'nothing_to_read' });
  });
  if (textBatch.length) jobs.push(file(textBatch));
  await Promise.all(jobs);
  for (const row of plan.unreadable) failures.push({ row, reason: 'nothing_to_read', final: true });

  const failed = [...new Set([...failures.map((f) => f.row.shortcode), ...plan.waiting.map((r) => r.shortcode)])];
  await recordFailures(env.supabaseUrl, caller, failures);

  if (verdicts.length) {
    const saved = await fetch(`${env.supabaseUrl}/rest/v1/rpc/apply_verdicts`, {
      method: 'POST',
      headers: { ...caller, 'content-type': 'application/json' },
      body: JSON.stringify({ p_verdicts: verdicts }),
    });
    if (!saved.ok) {
      console.error(`apply_verdicts ${saved.status}: ${(await saved.text()).slice(0, 300)}`);
      if (usd > 0) await recordUsage(env.supabaseUrl, caller, usd, billed);
      return error(502, 'Indexed, but could not save the results. Try again shortly.');
    }
  } else if (failed.length && rateLimited && !reels.count) {
    if (usd > 0) await recordUsage(env.supabaseUrl, caller, usd, billed);
    return error(429, 'OpenAI is busy. Retrying shortly.');
  }

  // After the verdicts are saved, never before: saving a verdict clears the post's old
  // embedding, so an embedding written first would be wiped straight away. A failure here
  // is not fatal; the posts are filed, and the next run embeds them.
  const embedded = await embed(env, caller, toEmbed);
  usd += embedded.usd;
  if (usd > 0) await recordUsage(env.supabaseUrl, caller, usd, billed);

  return Response.json({
    sorted: verdicts.length,
    embedded: embedded.count,
    transcribed: reels.count,
    unreadable: plan.unreadable.map((r) => r.shortcode),
    failed,
    usd,
  });
}

/**
 * A post this request could not index, and why. `final` gives up on it at once; a failure
 * not `counted` (a rate limit) is not held against the post at all.
 */
interface Failure {
  row: SortRow;
  reason: 'nothing_to_read' | 'no_answer' | 'openai_error' | 'transcribe_failed';
  final?: boolean;
  counted?: false;
}

/** Saves failures on the posts. Logged, not fatal: the next run simply tries again. */
async function recordFailures(url: string, caller: Caller, failures: Failure[]): Promise<void> {
  const rows = failures
    .filter((f) => f.counted !== false)
    .map((f) => ({ shortcode: f.row.shortcode, reason: f.reason, final: f.final === true }));
  if (!rows.length) return;
  const res = await fetch(`${url}/rest/v1/rpc/record_index_failures`, {
    method: 'POST',
    headers: { ...caller, 'content-type': 'application/json' },
    body: JSON.stringify({ p_rows: rows }),
  });
  if (!res.ok) console.error(`record_index_failures ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

/**
 * Transcribes reels and saves the transcripts, updating `rows` to match what the database
 * now holds. A reel too long to pay for, or with an address the server will not fetch, is
 * recorded as tried with nothing said, and never billed. A reel OpenAI fails on is tried
 * again on the next two runs, then filed without its words rather than held back forever.
 */
async function transcribeReels(
  env: Env,
  caller: Caller,
  reels: SortRow[],
): Promise<{ count: number; usd: number; rateLimited: boolean; failures: Failure[] }> {
  const failures: Failure[] = [];
  if (!reels.length) return { count: 0, usd: 0, rateLimited: false, failures };
  const outcomes = await Promise.all(
    reels.map((row): Promise<Transcribed> | Transcribed =>
      tooLong(row) || !isInstagramVideoUrl(row.video_url)
        ? { kind: 'done', text: '', seconds: 0 }
        : transcribe(row.video_url, row.duration_sec, env.openaiKey),
    ),
  );

  let usd = 0;
  const writes: { row: SortRow; transcript: string | null }[] = [];
  outcomes.forEach((outcome, i) => {
    const row = reels[i]!;
    if (outcome.kind === 'retry') {
      if (outcome.status === 429) failures.push({ row, reason: 'transcribe_failed', counted: false });
      else if (row.index_attempts >= MAX_TRANSCRIBE_ATTEMPTS - 1) writes.push({ row, transcript: '' });
      else failures.push({ row, reason: 'transcribe_failed' });
      return;
    }
    if (outcome.kind === 'done' && outcome.seconds !== 0) usd += transcribeCostUsd(outcome.seconds);
    writes.push({ row, transcript: outcome.kind === 'done' ? outcome.text : null });
  });
  const rateLimited = outcomes.some((o) => o.kind === 'retry' && o.status === 429);
  const heard = outcomes.filter((o) => o.kind === 'done' && o.text !== '').length;
  if (!writes.length) return { count: 0, usd, rateLimited, failures };

  const saved = await fetch(`${env.supabaseUrl}/rest/v1/rpc/set_transcripts`, {
    method: 'POST',
    headers: { ...caller, 'content-type': 'application/json' },
    body: JSON.stringify({ p_rows: writes.map(({ row, transcript }) => ({ shortcode: row.shortcode, transcript })) }),
  });
  if (!saved.ok) {
    // Paid for but not kept: the reels wait, and the next run transcribes them again.
    console.error(`set_transcripts ${saved.status}: ${(await saved.text()).slice(0, 300)}`);
    for (const { row } of writes) failures.push({ row, reason: 'transcribe_failed' });
    return { count: 0, usd, rateLimited, failures };
  }
  const now = new Date().toISOString();
  for (const { row, transcript } of writes) {
    row.transcribed_at = now;
    if (transcript !== row.transcript) row.embedded_at = null; // as reset_stale_embedding does
    row.transcript = transcript;
  }
  return { count: heard, usd, rateLimited, failures };
}

/** Embeds posts and saves the vectors. Returns how many were saved and what it cost. */
async function embed(env: Env, caller: Caller, items: { row: SortRow; filed?: Filed }[]): Promise<{ count: number; usd: number }> {
  const texts = items.map(({ row, filed }) => embeddingText(embeddingFields(row, filed)));
  const keep = items.filter((_, i) => texts[i] !== '');
  const inputs = texts.filter((t) => t !== '');
  if (!inputs.length) return { count: 0, usd: 0 };

  const { reply } = await openai('embeddings', embeddingsBody(inputs), env.openaiKey);
  const usd = embeddingCostUsd(reply);
  const vectors = readEmbeddings(reply, inputs.length);
  if (!vectors) return { count: 0, usd };

  const rows = keep.map(({ row }, i) => ({ shortcode: row.shortcode, embedding: vectorLiteral(vectors[i]!) }));
  const saved = await fetch(`${env.supabaseUrl}/rest/v1/rpc/set_embeddings`, {
    method: 'POST',
    headers: { ...caller, 'content-type': 'application/json' },
    body: JSON.stringify({ p_rows: rows }),
  });
  if (!saved.ok) {
    console.error(`set_embeddings ${saved.status}: ${(await saved.text()).slice(0, 300)}`);
    return { count: 0, usd };
  }
  return { count: rows.length, usd };
}

async function readPosts(url: string, caller: Caller, shortcodes: string[]): Promise<SortRow[] | null> {
  const list = shortcodes.map((s) => `"${s}"`).join(',');
  const res = await fetch(`${url}/rest/v1/posts?select=${SORT_COLUMNS}&shortcode=in.(${list})`, { headers: caller });
  if (!res.ok) return null;
  return (await res.json()) as SortRow[];
}

/** The caller's stored thumbnail as a data URL, or null when it cannot be read. */
async function thumbnail(url: string, caller: Caller, path: string): Promise<string | null> {
  try {
    const res = await fetch(`${url}/storage/v1/object/authenticated/thumbnails/${path}`, {
      headers: caller,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const type = (res.headers.get('content-type') ?? '').split(';')[0];
    if (type !== 'image/webp' && type !== 'image/jpeg') return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > MAX_THUMBNAIL_BYTES) return null;
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return `data:${type};base64,${btoa(binary)}`;
  } catch {
    return null;
  }
}

/** The web app calls this from the browser, so it answers CORS preflights. */
const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
  'access-control-allow-methods': 'POST, OPTIONS',
};

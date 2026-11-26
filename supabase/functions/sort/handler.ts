/**
 * POST /functions/v1/sort { shortcodes, refile?, suggest?, againBefore? }: sorts up to 25 of the caller's own posts on
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
 * `againBefore: <time>` is Organise again over many posts, 25 a request: each post filed
 * before that time is filed afresh by the model, except a category the user chose. The
 * web app sends the time the user confirmed the run, quoted beforehand, so a batch sent
 * twice finds its posts already filed and bills nothing more.
 *
 * A post about two things is filed under one and kept "Also in" the other, so it shows up
 * under both. A post filed as not sure keeps the categories the AI found likeliest as suggestions.
 * `suggest: true` asks for them for posts filed before suggestions existed: category
 * decisions only, a fraction of the cost of filing, and each post is asked at most once.
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
  planSuggest,
  SORT_COLUMNS,
  SUGGEST_COLUMNS,
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

  if (request.suggest) return suggest(env, caller, userId, request.shortcodes);

  const { refile, againBefore } = request;
  const rows = await readPosts(env.supabaseUrl, caller, request.shortcodes);
  if (!rows) return error(502, 'Could not read your posts. Try again shortly.');

  // Transcripts first: they change how a reel is filed, and what it is embedded from.
  const reels = await transcribeReels(env, caller, pickTranscribe(rows, { refile }));
  const plan = planSort(rows, { refile, againBefore });

  const at = new Date();
  const verdicts = plan.ruled.map(({ row, filed }) => verdictRow(row, filed, 'rules', at));
  // Everything filed in this request, plus anything filed earlier but not yet embedded.
  const toEmbed: { row: SortRow; filed?: Filed }[] = [...plan.ruled, ...plan.embedOnly.map((row) => ({ row }))];
  // Recorded on the posts, so a post that cannot be indexed says why and is not retried forever.
  const failures: Failure[] = [...reels.failures];
  // What the AI would suggest for each post it filed as not sure.
  const suggestions: Suggestion[] = [];
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
    const decided = readDecisions(decisions.reply);
    const results = new Map<number, ModelResult>(combine(body, decided, readSummaries(summaries.reply)).map((r) => [r.id, r]));
    const reason = decisions.reply === null && summaries.reply === null ? 'openai_error' : 'no_answer';
    batch.forEach((row, id) => {
      const result = results.get(id);
      // A rate limit is ours, not the post's: it is retried without counting against it.
      if (!result) return void (busy ? failures.push({ row, reason, counted: false }) : failures.push({ row, reason }));
      const filed = filedFrom(row, result);
      verdicts.push(verdictRow(row, filed, MODEL_LABEL, at, decided.get(id)?.also ?? null));
      toEmbed.push({ row, filed });
      if (filed.category === null) suggestions.push({ shortcode: row.shortcode, suggestions: decided.get(id)?.ranked ?? [] });
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

  await saveSuggestions(env.supabaseUrl, caller, suggestions);

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

interface Suggestion {
  shortcode: string;
  suggestions: string[];
}

/**
 * Asks the Decisions API alone which categories fit posts filed as not sure. Text posts go
 * in one call, thin ones one at a time with their picture. Every post asked about gets an
 * answer recorded, an empty one included, so it is never billed for again.
 *
 *   200 { suggested, usd }
 */
async function suggest(env: Env, caller: Caller, userId: string, shortcodes: string[]): Promise<Response> {
  const rows = await readPosts(env.supabaseUrl, caller, shortcodes, SUGGEST_COLUMNS);
  if (!rows) return error(502, 'Could not read your posts. Try again shortly.');
  const plan = planSuggest(rows);
  const out: Suggestion[] = plan.unreadable.map((row) => ({ shortcode: row.shortcode, suggestions: [] }));
  let usd = 0;
  let rateLimited = false;

  const ask = async (batch: SortRow[], image?: string): Promise<void> => {
    const body: AnalyzeRequest = { posts: batch.map((row, id) => ({ id, text: modelText(row) })), image };
    const { reply, status } = await openai('decisions', decisionsBody(body), env.openaiKey);
    usd += costUsd(usageOf(reply), { inputTokens: 0, outputTokens: 0 });
    if (status === 429) rateLimited = true;
    const decided = readDecisions(reply);
    // A post the API did not answer is left unasked, for the next run.
    batch.forEach((row, id) => {
      const d = decided.get(id);
      if (d) out.push({ shortcode: row.shortcode, suggestions: d.category ? [d.category] : d.ranked });
    });
  };

  const text = [...plan.text];
  const pictures = await Promise.all(plan.vision.map((row) => thumbnail(env.supabaseUrl, caller, thumbnailPath(userId, row))));
  const jobs: Promise<void>[] = [];
  plan.vision.forEach((row, i) => {
    const image = pictures[i];
    if (image) jobs.push(ask([row], image));
    else text.push(row);
  });
  if (text.length) jobs.push(ask(text));
  await Promise.all(jobs);

  const billed = plan.text.length + plan.vision.length;
  if (usd > 0) await recordUsage(env.supabaseUrl, caller, usd, billed);
  if (!out.length && rateLimited) return error(429, 'OpenAI is busy. Retrying shortly.');
  if (!(await saveSuggestions(env.supabaseUrl, caller, out))) return error(502, 'Could not save the suggestions. Try again shortly.');
  return Response.json({ suggested: out.filter((s) => s.suggestions.length > 0).length, usd });
}

/** Saves suggestions on the posts. True when there was nothing to save or it was saved. */
async function saveSuggestions(url: string, caller: Caller, rows: Suggestion[]): Promise<boolean> {
  if (!rows.length) return true;
  const res = await fetch(`${url}/rest/v1/rpc/set_suggestions`, {
    method: 'POST',
    headers: { ...caller, 'content-type': 'application/json' },
    body: JSON.stringify({ p_rows: rows }),
  });
  // Before the migration runs this fails; filing goes on, and the posts are asked later.
  if (!res.ok) console.error(`set_suggestions ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.ok;
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

async function readPosts(url: string, caller: Caller, shortcodes: string[], columns = SORT_COLUMNS): Promise<SortRow[] | null> {
  const list = shortcodes.map((s) => `"${s}"`).join(',');
  const res = await fetch(`${url}/rest/v1/posts?select=${columns}&shortcode=in.(${list})`, { headers: caller });
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

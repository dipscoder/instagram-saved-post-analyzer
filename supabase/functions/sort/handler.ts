/**
 * POST /functions/v1/sort { shortcodes }: sorts up to 25 of the caller's own posts on
 * the server and saves the verdicts to the account, so the web app can sort without the
 * extension. Paid from the project's OpenAI key, under the same daily cap as `analyze`.
 *
 * Everything runs with the caller's session, so Row Level Security limits every read and
 * write to their own rows. The server reads the posts itself and skips any already
 * sorted, so a repeated request costs nothing.
 *
 * Each post filed here, and any filed earlier but not yet searchable by meaning, is then
 * embedded for hybrid search.
 *
 *   200 { sorted, embedded, unreadable, failed, usd }
 *   400 bad request · 401 not signed in · 402 daily limit reached
 *   429 OpenAI is rate limiting (retry) · 502 OpenAI or the database failed · 500 not configured
 */

import { embeddingCostUsd, embeddingsBody, embeddingText, readEmbeddings, vectorLiteral } from '@saved-index/shared/embedding';
import type { Filed, ModelResult } from '@saved-index/shared/filing';
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
import { callerOf, capReached, error, openai, recordUsage, spentToday, type Caller } from '../_shared/server';
import {
  BadSortRequest,
  embeddingFields,
  filedFrom,
  modelText,
  parseSortRequest,
  planSort,
  SORT_COLUMNS,
  thumbnailPath,
  verdictRow,
  type SortRow,
} from './plan';

export interface Env {
  supabaseUrl: string;
  openaiKey: string;
  capUsd: number;
}

/** The largest stored thumbnail the function will send on: ten times a normal one. */
const MAX_THUMBNAIL_BYTES = 512 * 1024;

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

  let shortcodes: string[];
  try {
    shortcodes = parseSortRequest(await req.json());
  } catch (err) {
    return error(400, err instanceof BadSortRequest ? err.message : 'The request is not valid JSON.');
  }

  const spent = await spentToday(env.supabaseUrl, caller);
  if (spent === null) return error(502, 'Could not read today’s usage. Try again shortly.');
  if (spent >= env.capUsd) return error(402, capReached(env.capUsd));

  const rows = await readPosts(env.supabaseUrl, caller, shortcodes);
  if (!rows) return error(502, 'Could not read your posts. Try again shortly.');
  const plan = planSort(rows);

  const at = new Date();
  const verdicts = plan.ruled.map(({ row, filed }) => verdictRow(row, filed, 'rules', at));
  // Everything filed in this request, plus anything filed earlier but not yet embedded.
  const toEmbed: { row: SortRow; filed?: Filed }[] = [...plan.ruled, ...plan.embedOnly.map((row) => ({ row }))];
  const failed: string[] = [];
  let usd = 0;
  let rateLimited = false;

  const file = async (batch: SortRow[], image?: string): Promise<void> => {
    const body: AnalyzeRequest = { posts: batch.map((row, id) => ({ id, text: modelText(row) })), image };
    // Both calls are billed whether or not the other succeeds; one answering is enough.
    const [decisions, summaries] = await Promise.all([
      openai('decisions', decisionsBody(body), env.openaiKey),
      openai('responses', summaryBody(body), env.openaiKey),
    ]);
    usd += costUsd(usageOf(decisions.reply), usageOf(summaries.reply));
    if (decisions.status === 429 || summaries.status === 429) rateLimited = true;
    const results = new Map<number, ModelResult>(
      combine(body, readDecisions(decisions.reply), readSummaries(summaries.reply)).map((r) => [r.id, r]),
    );
    batch.forEach((row, id) => {
      const result = results.get(id);
      if (!result) return void failed.push(row.shortcode);
      const filed = filedFrom(row, result);
      verdicts.push(verdictRow(row, filed, MODEL_LABEL, at));
      toEmbed.push({ row, filed });
    });
  };

  const jobs: Promise<void>[] = [];
  if (plan.text.length) jobs.push(file(plan.text));
  for (const row of plan.vision) {
    jobs.push(
      thumbnail(env.supabaseUrl, caller, thumbnailPath(userId, row)).then((image) =>
        image ? file([row], image) : void plan.unreadable.push(row),
      ),
    );
  }
  await Promise.all(jobs);

  if (verdicts.length) {
    const saved = await fetch(`${env.supabaseUrl}/rest/v1/rpc/apply_verdicts`, {
      method: 'POST',
      headers: { ...caller, 'content-type': 'application/json' },
      body: JSON.stringify({ p_verdicts: verdicts }),
    });
    if (!saved.ok) {
      console.error(`apply_verdicts ${saved.status}: ${(await saved.text()).slice(0, 300)}`);
      if (usd > 0) await recordUsage(env.supabaseUrl, caller, usd, plan.text.length + plan.vision.length);
      return error(502, 'Indexed, but could not save the results. Try again shortly.');
    }
  } else if (failed.length && rateLimited) {
    if (usd > 0) await recordUsage(env.supabaseUrl, caller, usd, plan.text.length + plan.vision.length);
    return error(429, 'OpenAI is busy. Retrying shortly.');
  }

  // After the verdicts are saved, never before: saving a verdict clears the post's old
  // embedding, so an embedding written first would be wiped straight away. A failure here
  // is not fatal; the posts are filed, and the next run embeds them.
  const embedded = await embed(env, caller, toEmbed);
  usd += embedded.usd;
  if (usd > 0) await recordUsage(env.supabaseUrl, caller, usd, plan.text.length + plan.vision.length);

  return Response.json({
    sorted: verdicts.length,
    embedded: embedded.count,
    unreadable: plan.unreadable.map((r) => r.shortcode),
    failed,
    usd,
  });
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

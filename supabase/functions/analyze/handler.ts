/**
 * POST /functions/v1/analyze: files up to 25 posts for the signed-in caller, paid from
 * the OpenAI key held in this project's secrets.
 *
 * The caller's own session is used for everything it does in the database, so Row Level
 * Security still applies: it reads only the caller's usage and can only add to it. The
 * OpenAI key is read from the environment, used as a request header, and never echoed.
 *
 *   200 { results, usage, usd, model }
 *   400 bad request · 401 not signed in · 402 daily limit reached
 *   429 OpenAI is rate limiting (retry) · 502 OpenAI failed · 500 not configured
 */

import {
  BadRequest,
  combine,
  costUsd,
  decisionsBody,
  MODEL_LABEL,
  parseRequest,
  readDecisions,
  readSummaries,
  summaryBody,
  usageOf,
  type Usage,
} from './decide';

export interface Env {
  supabaseUrl: string;
  openaiKey: string;
  /** Per user, per UTC day. */
  capUsd: number;
}

const OPENAI = 'https://api.openai.com/v1';

export async function handle(req: Request, env: Env): Promise<Response> {
  if (req.method !== 'POST') return error(405, 'Use POST.');
  if (!env.openaiKey || !env.supabaseUrl) return error(500, 'Analysis is not set up on the server yet.');

  // The caller's session, and the project's publishable key it was sent with.
  const caller = {
    apikey: req.headers.get('apikey') ?? '',
    authorization: req.headers.get('authorization') ?? '',
  };
  if (!caller.apikey || !/^Bearer\s+\S+$/.test(caller.authorization)) return error(401, 'Sign in first.');
  const user = await fetch(`${env.supabaseUrl}/auth/v1/user`, { headers: caller });
  if (!user.ok) return error(401, 'Sign in first.');

  let body;
  try {
    body = parseRequest(await req.json());
  } catch (err) {
    return error(400, err instanceof BadRequest ? err.message : 'The request is not valid JSON.');
  }

  const spent = await spentToday(env.supabaseUrl, caller);
  if (spent === null) return error(502, 'Could not read today’s usage. Try again shortly.');
  if (spent >= env.capUsd) {
    return error(402, `Today's analysis limit of $${env.capUsd.toFixed(2)} is used up. It resets at midnight UTC.`);
  }

  // Both calls are billed whether or not the other succeeds, so a batch fails only when
  // neither answered; one answering is still a usable result.
  const [decisions, summaries] = await Promise.all([
    openai('decisions', decisionsBody(body), env.openaiKey),
    openai('responses', summaryBody(body), env.openaiKey),
  ]);
  const usage = { decisions: usageOf(decisions.reply), summary: usageOf(summaries.reply) };
  const usd = costUsd(usage.decisions, usage.summary);
  if (usd > 0) await recordUsage(env.supabaseUrl, caller, usd, body.posts.length);

  if (!decisions.reply && !summaries.reply) {
    const status = decisions.status === 429 || summaries.status === 429 ? 429 : 502;
    return error(status, status === 429 ? 'OpenAI is busy. Retrying shortly.' : 'OpenAI did not answer.');
  }

  return Response.json({
    results: combine(body, readDecisions(decisions.reply), readSummaries(summaries.reply)),
    usage: total(usage.decisions, usage.summary),
    usd,
    model: MODEL_LABEL,
  });
}

/** One OpenAI call. `reply` is null on any failure; `status` says which. */
async function openai(endpoint: string, body: object, key: string): Promise<{ reply: unknown; status: number }> {
  try {
    const res = await fetch(`${OPENAI}/${endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      // The status and OpenAI's own message, never the request: it carries the key.
      console.error(`OpenAI ${endpoint} ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return { reply: null, status: res.status };
    }
    return { reply: await res.json(), status: res.status };
  } catch (err) {
    console.error(`OpenAI ${endpoint} failed: ${err instanceof Error ? err.message : String(err)}`);
    return { reply: null, status: 0 };
  }
}

type Caller = { apikey: string; authorization: string };

/** What the caller has spent today (UTC), or null if it could not be read. */
async function spentToday(url: string, caller: Caller): Promise<number | null> {
  const day = new Date().toISOString().slice(0, 10);
  const res = await fetch(`${url}/rest/v1/usage?select=usd&day=eq.${day}`, { headers: caller });
  if (!res.ok) return null;
  const rows = (await res.json()) as { usd?: unknown }[];
  return Number(rows[0]?.usd ?? 0) || 0;
}

/** Adds to today's usage. A failure is logged, not fatal: the work is already done. */
async function recordUsage(url: string, caller: Caller, usd: number, posts: number): Promise<void> {
  const res = await fetch(`${url}/rest/v1/rpc/record_usage`, {
    method: 'POST',
    headers: { ...caller, 'content-type': 'application/json' },
    body: JSON.stringify({ p_usd: usd, p_posts: posts }),
  });
  if (!res.ok) console.error(`record_usage ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

function total(a: Usage, b: Usage): Usage {
  return { inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens };
}

function error(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}

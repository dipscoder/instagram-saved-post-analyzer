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
import { callerOf, capReached, error, openai, recordUsage, spentToday } from '../_shared/server';

export interface Env {
  supabaseUrl: string;
  openaiKey: string;
  /** Per user, per UTC day. */
  capUsd: number;
}

export async function handle(req: Request, env: Env): Promise<Response> {
  if (req.method !== 'POST') return error(405, 'Use POST.');
  if (!env.openaiKey || !env.supabaseUrl) return error(500, 'Analysis is not set up on the server yet.');

  const who = await callerOf(req, env.supabaseUrl);
  if (!who) return error(401, 'Sign in first.');
  const { caller } = who;

  let body;
  try {
    body = parseRequest(await req.json());
  } catch (err) {
    return error(400, err instanceof BadRequest ? err.message : 'The request is not valid JSON.');
  }

  const spent = await spentToday(env.supabaseUrl, caller);
  if (spent === null) return error(502, 'Could not read today’s usage. Try again shortly.');
  if (spent >= env.capUsd) {
    return error(402, capReached(env.capUsd));
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

function total(a: Usage, b: Usage): Usage {
  return { inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens };
}

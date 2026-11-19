/**
 * POST /functions/v1/search { query, category?, collection?, needsLook? }: hybrid search
 * over the caller's own library. The query is embedded, then `search_posts` ranks posts by
 * keyword match and by meaning together, so "quick dinner" finds "sheet-pan harissa
 * chicken" and an exact handle or hashtag still comes first.
 *
 * Runs with the caller's session, so Row Level Security limits it to their own posts. If
 * the embedding call fails, the search still runs on keywords alone.
 *
 *   200 { posts, semantic }   semantic is false when only keywords were used
 *   400 bad request · 401 not signed in · 502 the database failed · 500 not configured
 */

import { cleanQuery, embeddingsBody, readEmbeddings, vectorLiteral } from '@saved-index/shared/embedding';
import { callerOf, error, openai } from '../_shared/server';
import { BadSearch, parseSearch } from './parse';

export interface Env {
  supabaseUrl: string;
  openaiKey: string;
}

export async function handle(req: Request, env: Env): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  const res = await route(req, env);
  for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
  return res;
}

async function route(req: Request, env: Env): Promise<Response> {
  if (req.method !== 'POST') return error(405, 'Use POST.');
  if (!env.supabaseUrl) return error(500, 'Search is not set up on the server yet.');

  const who = await callerOf(req, env.supabaseUrl);
  if (!who) return error(401, 'Sign in first.');

  let search;
  try {
    search = parseSearch(await req.json());
  } catch (err) {
    return error(400, err instanceof BadSearch ? err.message : 'The request is not valid JSON.');
  }

  // A query embedding costs about a millionth of a dollar, so it is not metered.
  let embedding: string | null = null;
  if (env.openaiKey) {
    const { reply } = await openai('embeddings', embeddingsBody([cleanQuery(search.query)]), env.openaiKey);
    const vectors = readEmbeddings(reply, 1);
    if (vectors) embedding = vectorLiteral(vectors[0]!);
  }

  const res = await fetch(`${env.supabaseUrl}/rest/v1/rpc/search_posts`, {
    method: 'POST',
    headers: { ...who.caller, 'content-type': 'application/json' },
    body: JSON.stringify({
      p_query: search.query,
      p_embedding: embedding,
      p_category: search.category,
      p_collection: search.collection,
      p_needs_look: search.needsLook,
    }),
  });
  if (!res.ok) {
    console.error(`search_posts ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return error(502, 'Search failed. Try again shortly.');
  }
  return Response.json({ posts: await res.json(), semantic: embedding !== null });
}

/** The web app calls this from the browser, so it answers CORS preflights. */
const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
  'access-control-allow-methods': 'POST, OPTIONS',
};

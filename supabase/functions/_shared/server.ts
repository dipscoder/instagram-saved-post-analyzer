/**
 * The I/O the Edge Functions share: who the caller is, what they have spent today, one
 * OpenAI call, and transcribing a reel. Everything runs with the caller's own session, so Row Level Security
 * applies to every read and write; the OpenAI key is used only as a request header.
 */

import { MAX_VIDEO_BYTES, readTranscript, TRANSCRIBE_MODEL } from '@saved-index/shared/transcript';

const OPENAI = 'https://api.openai.com/v1';

export type Caller = { apikey: string; authorization: string };

/** The caller's session headers and user id, or null when they are not signed in. */
export async function callerOf(req: Request, supabaseUrl: string): Promise<{ caller: Caller; userId: string } | null> {
  const caller = {
    apikey: req.headers.get('apikey') ?? '',
    authorization: req.headers.get('authorization') ?? '',
  };
  if (!caller.apikey || !/^Bearer\s+\S+$/.test(caller.authorization)) return null;
  const res = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: caller });
  if (!res.ok) return null;
  const user = (await res.json()) as { id?: unknown };
  return typeof user.id === 'string' ? { caller, userId: user.id } : null;
}

/** One OpenAI call. `reply` is null on any failure; `status` says which. */
export async function openai(endpoint: string, body: object, key: string): Promise<{ reply: unknown; status: number }> {
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

/** What the caller has spent today (UTC), or null if it could not be read. */
export async function spentToday(url: string, caller: Caller): Promise<number | null> {
  const day = new Date().toISOString().slice(0, 10);
  const res = await fetch(`${url}/rest/v1/usage?select=usd&day=eq.${day}`, { headers: caller });
  if (!res.ok) return null;
  const rows = (await res.json()) as { usd?: unknown }[];
  return Number(rows[0]?.usd ?? 0) || 0;
}

/** Adds to today's usage. A failure is logged, not fatal: the work is already done. */
export async function recordUsage(url: string, caller: Caller, usd: number, posts: number): Promise<void> {
  const res = await fetch(`${url}/rest/v1/rpc/record_usage`, {
    method: 'POST',
    headers: { ...caller, 'content-type': 'application/json' },
    body: JSON.stringify({ p_usd: usd, p_posts: posts }),
  });
  if (!res.ok) console.error(`record_usage ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

export function capReached(capUsd: number): string {
  return `Today's analysis limit of $${capUsd.toFixed(2)} is used up. It resets at midnight UTC.`;
}

export function error(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}

/**
 * How transcribing one reel went:
 *   done         a transcript, possibly '' when nothing was said; billed for `seconds`
 *   unavailable  the video could not be downloaded (its address expired, or it is too
 *                big); nothing was billed, and a fresh address from a sync retries it
 *   retry        OpenAI failed for now; nothing is recorded, so the next run tries again
 */
export type Transcribed = { kind: 'done'; text: string; seconds: number | null } | { kind: 'unavailable' } | { kind: 'retry'; status: number };

/** Downloads a reel from Instagram's CDN and transcribes it. Never throws. */
export async function transcribe(videoUrl: string, durationSec: number | null, key: string): Promise<Transcribed> {
  const video = await download(videoUrl, MAX_VIDEO_BYTES);
  if (!video) return { kind: 'unavailable' };
  const form = new FormData();
  form.append('file', new Blob([video.bytes], { type: video.type }), 'reel.mp4');
  form.append('model', TRANSCRIBE_MODEL);
  form.append('response_format', 'json');
  try {
    const res = await fetch(`${OPENAI}/audio/transcriptions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) {
      console.error(`OpenAI audio/transcriptions ${res.status}: ${(await res.text()).slice(0, 300)}`);
      // A 400 is this file (no audio track, a format it will not read): asking again
      // gives the same answer, so it is recorded as nothing said, and was not billed.
      return res.status === 400 ? { kind: 'done', text: '', seconds: 0 } : { kind: 'retry', status: res.status };
    }
    const { text, seconds } = readTranscript(await res.json(), durationSec);
    return text === null ? { kind: 'retry', status: 502 } : { kind: 'done', text, seconds };
  } catch (err) {
    console.error(`OpenAI audio/transcriptions failed: ${err instanceof Error ? err.message : String(err)}`);
    return { kind: 'retry', status: 0 };
  }
}

/** A video's bytes, or null when it cannot be had within the size limit. */
async function download(url: string, maxBytes: number): Promise<{ bytes: Uint8Array<ArrayBuffer>; type: string } | null> {
  try {
    const res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
    if (!res.ok || !res.body) return null;
    const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim();
    if (!type.startsWith('video/')) return null;
    if (Number(res.headers.get('content-length')) > maxBytes) return null;
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      size += chunk.length;
      if (size > maxBytes) return null;
      chunks.push(chunk);
    }
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) {
      bytes.set(c, at);
      at += c.length;
    }
    return { bytes, type };
  } catch {
    return null;
  }
}

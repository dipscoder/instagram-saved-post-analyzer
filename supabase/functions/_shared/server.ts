/**
 * The I/O both Edge Functions share: who the caller is, what they have spent today, and
 * one OpenAI call. Everything runs with the caller's own session, so Row Level Security
 * applies to every read and write; the OpenAI key is used only as a request header.
 */

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

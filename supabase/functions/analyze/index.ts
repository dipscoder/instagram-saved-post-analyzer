/**
 * Deno entry for the `analyze` Edge Function. Everything it does is in handler.ts.
 *
 * Secrets (Dashboard → Edge Functions → Secrets): OPENAI_API_KEY, and optionally
 * DAILY_CAP_USD, the most one user may spend in a UTC day (default $1). SUPABASE_URL is
 * provided by the platform.
 */

import { handle } from './handler';

declare const Deno: { env: { get(name: string): string | undefined } };

export default {
  fetch: (req: Request) =>
    handle(req, {
      supabaseUrl: Deno.env.get('SUPABASE_URL') ?? '',
      openaiKey: Deno.env.get('OPENAI_API_KEY') ?? '',
      capUsd: Number(Deno.env.get('DAILY_CAP_USD') ?? '') || 1,
    }),
};

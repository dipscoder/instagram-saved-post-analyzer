/**
 * Deno entry for the `sort` Edge Function. Everything it does is in handler.ts.
 *
 * Uses the same secrets as `analyze`: OPENAI_API_KEY, and optionally DAILY_CAP_USD.
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

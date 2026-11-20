/**
 * Deno entry for the `search` Edge Function. Everything it does is in handler.ts.
 *
 * Uses the same OPENAI_API_KEY secret as `analyze` and `sort`, to embed the query.
 */

import { handle } from './handler';

declare const Deno: { env: { get(name: string): string | undefined } };

export default {
  fetch: (req: Request) =>
    handle(req, {
      supabaseUrl: Deno.env.get('SUPABASE_URL') ?? '',
      openaiKey: Deno.env.get('OPENAI_API_KEY') ?? '',
    }),
};

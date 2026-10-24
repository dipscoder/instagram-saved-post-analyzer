/**
 * Who answers when a post needs a model: OpenAI with the key saved in this browser, or,
 * when you are signed in, the account's `analyze` function, which holds its own key on
 * the server (supabase/functions/analyze).
 *
 * The categoriser decides what needs filing, what it may cost and where answers are
 * banked. An analyst only answers, so both paths share every guard around them.
 */

import { FILING_PROMPT, parseResults, type ModelResult } from '@saved-index/shared/filing';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../config';
import { supabase } from './account';
import {
  ProviderError,
  readJson,
  usdFor,
  type ModelInfo,
  type Provider,
  type Usage,
} from './providers/index';

export interface Analysis {
  /** Null when the reply held nothing readable; the posts stay pending. */
  results: ModelResult[] | null;
  usage: Usage;
  usd: number;
  /** Recorded on each verdict as `modelUsed`. */
  model: string;
}

export interface Image {
  mediaType: string;
  base64: string;
}

export interface Analyst {
  /** Priced for the estimate shown before a run; real spend comes from each reply. */
  readonly pricing: ModelInfo | undefined;
  readonly supportsVision: boolean;
  /**
   * Files posts described by `texts` (see `signature()` in filing.ts). Answer ids are
   * positions in `texts`. `image` is only ever sent with a single post.
   */
  analyse(texts: string[], image?: Image): Promise<Analysis>;
}

export function ownKeyAnalyst(provider: Provider, apiKey: string, model: string): Analyst {
  const pricing = provider.models.find((m) => m.id === model);
  return {
    pricing,
    supportsVision: pricing?.supportsVision ?? false,
    async analyse(texts, image) {
      const user = image
        ? `File this single post using its thumbnail. Use id=0.\n\nid=0 | ${texts[0]}`
        : `Categorise these ${texts.length} posts.\n\n${texts.map((t, i) => `id=${i} | ${t}`).join('\n\n')}`;
      const reply = await provider.chat(
        { system: FILING_PROMPT, user, image, maxTokens: image ? 140 : 100 + 70 * texts.length },
        apiKey,
        model,
      );
      return { results: readable(reply.text), usage: reply.usage, usd: usdFor(pricing, reply.usage), model };
    },
  };
}

/**
 * Close to what the account's function costs per post, for the pre-run estimate: the
 * Decisions API bills input only, and the summary call is priced like GPT-5.6 Luna.
 */
const ACCOUNT_PRICING: ModelInfo = {
  id: 'account',
  label: 'Your account',
  inputPer1M: 0.3,
  outputPer1M: 1.2,
  supportsVision: true,
};

const ANALYZE_URL = `${SUPABASE_URL}/functions/v1/analyze`;

export function accountAnalyst(): Analyst {
  return {
    pricing: ACCOUNT_PRICING,
    supportsVision: true,
    async analyse(texts, image) {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new ProviderError('You are signed out. Sign in again to keep indexing.', 401, false);

      const res = await fetch(ANALYZE_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          apikey: SUPABASE_PUBLISHABLE_KEY,
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          posts: texts.map((text, id) => ({ id, text })),
          image: image ? `data:${image.mediaType};base64,${image.base64}` : undefined,
        }),
      });
      if (!res.ok) throw await accountError(res);

      const reply = await readJson<Partial<Analysis>>(res);
      return {
        results: Array.isArray(reply.results) ? reply.results : null,
        usage: {
          inputTokens: Number(reply.usage?.inputTokens) || 0,
          outputTokens: Number(reply.usage?.outputTokens) || 0,
        },
        usd: Number(reply.usd) || 0,
        model: typeof reply.model === 'string' ? reply.model.slice(0, 100) : 'account',
      };
    },
  };
}

/** The function answers errors as `{ error }`. Only overload and outages are retried. */
async function accountError(res: Response): Promise<ProviderError> {
  let message = '';
  try {
    message = String(((await res.json()) as { error?: unknown }).error ?? '').slice(0, 300);
  } catch {
    /* not JSON: an outage page or a proxy */
  }
  if (res.status === 401) message = 'Your session has expired. Sign in again to keep indexing.';
  const retryable = res.status === 429 || res.status >= 500;
  return new ProviderError(message || `Your account's analysis returned ${res.status}.`, res.status, retryable);
}

function readable(text: string): ModelResult[] | null {
  try {
    return parseResults(text);
  } catch {
    return null;
  }
}

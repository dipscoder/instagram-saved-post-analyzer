/**
 * Provider-agnostic model adapter.
 *
 * Every call in here runs in the service worker. No content script ever sees a key —
 * see settings.ts for why that isolation holds.
 */

import type { ProviderId } from '../../types';

export interface ChatRequest {
  system: string;
  user: string;
  /** Present only on the tier-3 vision fallback. */
  image?: { mediaType: string; base64: string };
  maxTokens: number;
}

/** What every provider reports back so spend can be metered rather than estimated. */
export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface ChatResult {
  text: string;
  usage: Usage;
}

export interface ModelInfo {
  id: string;
  label: string;
  /** Published list price, USD per million tokens. */
  inputPer1M: number;
  outputPer1M: number;
  /** Optional announced price change, applied automatically at the stated UTC instant. */
  priceAfter?: { at: number; inputPer1M: number; outputPer1M: number };
  supportsVision: boolean;
}

export interface Provider {
  id: ProviderId;
  label: string;
  keyPlaceholder: string;
  keysUrl: string;
  models: ModelInfo[];
  chat(req: ChatRequest, key: string, model: string): Promise<ChatResult>;
}

/**
 * Measured against real batches: a post contributes roughly this much once the caption is
 * clipped to 400 characters and the system prompt is amortised across a batch of 25.
 * Used only for the pre-run estimate — actual spend comes from reported usage.
 */
const EST_INPUT_TOKENS_PER_POST = 145;
const EST_OUTPUT_TOKENS_PER_POST = 50;

/** Upper bound: assumes every pending post reaches the model. Rules make it cheaper. */
export function estimateUsd(
  model: ModelInfo | undefined,
  posts: number,
  at = Date.now(),
): number {
  if (!model || posts <= 0) return 0;
  const input = (posts * EST_INPUT_TOKENS_PER_POST) / 1_000_000;
  const output = (posts * EST_OUTPUT_TOKENS_PER_POST) / 1_000_000;
  const price = priceAt(model, at);
  return input * price.inputPer1M + output * price.outputPer1M;
}

export function usdFor(model: ModelInfo | undefined, usage: Usage, at = Date.now()): number {
  if (!model) return 0;
  const price = priceAt(model, at);
  return (
    (usage.inputTokens / 1_000_000) * price.inputPer1M +
    (usage.outputTokens / 1_000_000) * price.outputPer1M
  );
}

function priceAt(model: ModelInfo, at: number): Pick<ModelInfo, 'inputPer1M' | 'outputPer1M'> {
  return model.priceAfter && at >= model.priceAfter.at ? model.priceAfter : model;
}

export function findModel(id: ProviderId, model: string): ModelInfo | undefined {
  return PROVIDERS[id]?.models.find((m) => m.id === model);
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
    /** What the provider itself said to wait, when it said anything. */
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/**
 * Strips anything that looks like a key from text before it reaches a log or the UI.
 * Applied on every error path — provider errors sometimes echo the request back.
 */
export function redact(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_\-]{16,}/g, 'sk-…')
    .replace(/AIza[A-Za-z0-9_\-]{20,}/g, 'AIza…')
    .replace(/Bearer\s+[A-Za-z0-9._\-]{16,}/gi, 'Bearer …');
}

export async function readError(res: Response): Promise<ProviderError> {
  let detail = '';
  try {
    // Redact first, then truncate. The other order let a key that straddled character 400
    // survive as a fragment too short for the pattern to match.
    detail = redact(await res.text()).slice(0, 400);
  } catch {
    /* body already consumed or unreadable */
  }

  const retryable = res.status === 429 || res.status >= 500;
  const friendly =
    res.status === 401 || res.status === 403
      ? 'Key rejected — check the key and try again.'
      : res.status === 429
        ? 'Rate limited by the provider.'
        : `Provider returned ${res.status}.`;

  return new ProviderError(`${friendly} ${detail}`.trim(), res.status, retryable, retryAfter(res));
}

/** `retry-after` is either seconds or an HTTP date. Both are worth more than a guess. */
function retryAfter(res: Response): number | null {
  const raw = res.headers.get('retry-after');
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds, 120) * 1000;
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, Math.min(at - Date.now(), 120_000)) : null;
}

/**
 * A 200 is not a promise of JSON. A captive portal or a proxy answers with an HTML page,
 * and an unguarded `res.json()` turned that into a raw `SyntaxError` shown verbatim in
 * the popup — and, being no kind of ProviderError, one that was never retried.
 */
export async function readJson<T>(res: Response): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch {
    throw new ProviderError('Provider returned a non-JSON response.', res.status, true);
  }
}

/** Models wrap JSON in prose or fences often enough that this is worth centralising. */
export function parseJsonLoose<T>(text: string): T {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fenced?.[1] ?? text;
  const start = body.search(/[[{]/);
  if (start === -1) throw new Error('Model returned no JSON.');

  const opening = body[start];
  const closing = opening === '[' ? ']' : '}';
  const end = body.lastIndexOf(closing);
  if (end <= start) throw new Error('Model returned truncated JSON.');

  return JSON.parse(body.slice(start, end + 1)) as T;
}

import { anthropic } from './anthropic';
import { openai } from './openai';
import { gemini } from './gemini';
import { openrouter } from './openrouter';

export const PROVIDERS: Record<ProviderId, Provider> = {
  anthropic,
  openai,
  gemini,
  openrouter,
};

export function getProvider(id: ProviderId): Provider {
  const p = PROVIDERS[id];
  if (!p) throw new Error(`Unknown provider: ${id}`);
  return p;
}

/** One cheap round-trip behind the popup's Test button. */
export async function testKey(id: ProviderId, key: string, model: string): Promise<void> {
  const provider = getProvider(id);
  await provider.chat(
    // Reasoning-capable models count hidden reasoning inside their output ceiling. A
    // 12-token test could therefore return no visible JSON even when the key was valid.
    { system: 'Return JSON only.', user: 'Reply with {"ok":true}.', maxTokens: 128 },
    key,
    model,
  );
}

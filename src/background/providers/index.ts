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

export interface ModelInfo {
  id: string;
  label: string;
  /** Rough USD for 1,000 text-only posts. Indicative, for the popup's estimate. */
  costPer1kPosts: number;
  supportsVision: boolean;
}

export interface Provider {
  id: ProviderId;
  label: string;
  keyPlaceholder: string;
  keysUrl: string;
  models: ModelInfo[];
  chat(req: ChatRequest, key: string, model: string): Promise<string>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
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
    detail = (await res.text()).slice(0, 400);
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

  return new ProviderError(`${friendly} ${redact(detail)}`.trim(), res.status, retryable);
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
    { system: 'Reply with the single word OK.', user: 'ping', maxTokens: 8 },
    key,
    model,
  );
}

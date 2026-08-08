/**
 * Three-tier categorisation, cheapest first.
 *
 *   1. Deterministic rules   free      hashtag + keyword match against the taxonomy
 *   2. Text-only LLM         cheap     caption + hashtags + handle, 25 posts per request
 *   3. Vision                dearest   only when the caption is empty or under 15 chars
 *
 * A post that settles at tier 1 never reaches tier 2, and only the small minority with no
 * usable caption reaches tier 3 — image tokens cost roughly fifty times what the
 * equivalent text costs, so keeping tier 3 rare is most of the cost control.
 *
 * No transcription: Instagram does not expose transcripts on web.
 */

import * as db from './db';
import { getSettings } from './settings';
import { getSpend, record } from './spend';
import {
  estimateUsd,
  findModel,
  getProvider,
  parseJsonLoose,
  ProviderError,
  redact,
  usdFor,
  type ChatResult,
} from './providers/index';
import { CATEGORY_NAMES, classifyByRules, normalizeCategory } from '../taxonomy';
import type { IndexProgress, PostRecord } from '../types';

const TEXT_BATCH_SIZE = 25;
const MAX_IN_FLIGHT = 3;
const MAX_ATTEMPTS = 4;
/** Below this a caption carries no signal worth sending as text. */
const MIN_CAPTION_CHARS = 15;
const CAPTION_CHAR_BUDGET = 400;

const SYSTEM_PROMPT = [
  'You categorise saved Instagram posts into a fixed taxonomy.',
  '',
  `Allowed categories (use exactly one, copied verbatim): ${CATEGORY_NAMES.join(', ')}.`,
  '',
  'For each post return:',
  '  id          the id you were given, unchanged',
  '  category    one allowed category, verbatim',
  '  subcategory two or three words, or null',
  '  tags        2-4 lowercase keywords',
  '  summary     one sentence under 90 characters saying what the post is about.',
  '              Write it as a note to self. No "This post shows", no hashtags.',
  '',
  'Respond with JSON only, no prose and no code fences:',
  '{"results":[{"id":0,"category":"…","subcategory":null,"tags":["…"],"summary":"…"}]}',
].join('\n');

interface ModelResult {
  id: number;
  category?: string;
  subcategory?: string | null;
  tags?: string[];
  summary?: string;
}

export type ProgressFn = (p: IndexProgress) => void;

export class Categorizer {
  private phase: IndexProgress['phase'] = 'idle';
  private message: string | null = null;
  private running: Promise<void> | null = null;
  private cancelled = false;
  /**
   * Records written in the current round. The outer loop re-reads pending work each
   * pass, so a round that writes nothing would hand back an identical queue and spin
   * forever — this is the guard against that.
   */
  private roundUpdates = 0;

  constructor(private readonly onProgress: ProgressFn) {}

  async progress(): Promise<IndexProgress> {
    const [{ total, categorized }, spend, settings] = await Promise.all([
      db.stats(),
      getSpend(),
      getSettings(),
    ]);
    const pending = Math.max(0, total - categorized);
    return {
      phase: this.phase,
      total,
      categorized,
      pending,
      spentUsd: spend.usd,
      estimateUsd: estimateUsd(findModel(settings.provider, settings.model), pending),
      message: this.message,
    };
  }

  isRunning(): boolean {
    return this.phase === 'running';
  }

  pause(): void {
    if (this.phase !== 'running') return;
    this.cancelled = true;
    this.phase = 'paused';
    void this.emit();
  }

  /** Idempotent: calling start twice does not start two loops. */
  async start(): Promise<void> {
    if (this.running) return this.running;
    this.cancelled = false;
    this.message = null;
    this.phase = 'running';
    void this.emit();

    this.running = this.loop().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  async reindex(): Promise<void> {
    this.pause();
    await this.running?.catch(() => {});
    await db.resetCategories();
    await this.start();
  }

  private async emit(): Promise<void> {
    this.onProgress(await this.progress());
  }

  private async loop(): Promise<void> {
    const settings = await getSettings();
    if (!settings.apiKey) {
      this.phase = 'error';
      this.message = 'No API key set. Connect a provider in the popup.';
      return void this.emit();
    }

    const provider = getProvider(settings.provider);

    try {
      for (;;) {
        if (this.cancelled) return void this.emit();

        // Re-read each round: passive capture keeps adding posts while we work.
        const pending = await db.pendingCategorization(500);
        if (!pending.length) break;
        this.roundUpdates = 0;

        // --- tier 1: free, and it shrinks the LLM workload before we spend anything ---
        const needsModel: PostRecord[] = [];
        const ruled: PostRecord[] = [];

        for (const post of pending) {
          const hit = classifyByRules(post);
          if (hit) {
            ruled.push({
              ...post,
              category: hit.category,
              subcategory: hit.subcategory,
              tags: post.hashtags.slice(0, 4),
              summary: firstLine(post.caption) || post.altText || hit.category,
              categorizedAt: Date.now(),
              modelUsed: 'rules',
            });
          } else {
            needsModel.push(post);
          }
        }

        if (ruled.length) {
          await db.updateMany(ruled);
          this.roundUpdates += ruled.length;
          await this.emit();
        }

        if (!needsModel.length) continue;

        // --- tiers 2 and 3 ---
        const visionPosts = needsModel.filter(
          (p) => p.caption.trim().length < MIN_CAPTION_CHARS,
        );
        const textPosts = needsModel.filter(
          (p) => p.caption.trim().length >= MIN_CAPTION_CHARS,
        );

        const jobs: (() => Promise<void>)[] = [];

        for (let i = 0; i < textPosts.length; i += TEXT_BATCH_SIZE) {
          const batch = textPosts.slice(i, i + TEXT_BATCH_SIZE);
          jobs.push(() => this.runTextBatch(batch, provider, settings));
        }

        const supportsVision =
          provider.models.find((m) => m.id === settings.model)?.supportsVision ?? false;
        for (const post of visionPosts) {
          jobs.push(() =>
            supportsVision
              ? this.runVision(post, provider, settings)
              : this.markUnclassifiable(post),
          );
        }

        await this.pool(jobs);

        // A rate-limit or auth failure sets phase; stop rather than hammering.
        if (this.phase === 'error' || this.cancelled) return void this.emit();

        if (this.roundUpdates === 0) {
          // Every job ran and none produced a usable record — almost always the model
          // refusing to return parseable JSON. Retrying the identical queue would spin.
          this.phase = 'error';
          this.message =
            'The model returned nothing usable for a full pass. Try a different model.';
          return void this.emit();
        }
      }

      this.phase = 'done';
      await this.emit();
    } catch (err) {
      this.phase = 'error';
      this.message = redact(err instanceof Error ? err.message : String(err));
      await this.emit();
    }
  }

  /** Bounded-concurrency runner: never more than MAX_IN_FLIGHT requests outstanding. */
  private async pool(jobs: (() => Promise<void>)[]): Promise<void> {
    let cursor = 0;
    const workers = Array.from({ length: Math.min(MAX_IN_FLIGHT, jobs.length) }, async () => {
      while (cursor < jobs.length && !this.cancelled && this.phase !== 'error') {
        const job = jobs[cursor++];
        if (job) await job();
      }
    });
    await Promise.all(workers);
  }

  private async runTextBatch(
    batch: PostRecord[],
    provider: ReturnType<typeof getProvider>,
    settings: { apiKey: string; model: string },
  ): Promise<void> {
    const lines = batch.map((p, i) => {
      const caption = p.caption.replace(/\s+/g, ' ').slice(0, CAPTION_CHAR_BUDGET);
      const tags = p.hashtags.length ? ` | hashtags: ${p.hashtags.slice(0, 12).join(' ')}` : '';
      return `id=${i} | ${p.handle}${tags}\ncaption: ${caption || '(none)'}`;
    });

    const result = await this.callWithRetry(
      () =>
        provider.chat(
          {
            system: SYSTEM_PROMPT,
            user: `Categorise these ${batch.length} posts.\n\n${lines.join('\n\n')}`,
            maxTokens: 180 * batch.length,
          },
          settings.apiKey,
          settings.model,
        ),
      provider.models.find((m) => m.id === settings.model),
    );
    if (result === null) return;

    let results: ModelResult[];
    try {
      const parsed = parseJsonLoose<{ results?: ModelResult[] } | ModelResult[]>(result.text);
      results = Array.isArray(parsed) ? parsed : (parsed.results ?? []);
    } catch {
      // Bad JSON is not worth a retry storm; leave the batch pending for next round.
      return;
    }

    const updates: PostRecord[] = [];
    for (const r of results) {
      const post = batch[r.id];
      if (!post) continue;
      updates.push(applyResult(post, r, settings.model));
    }

    if (updates.length) {
      await db.updateMany(updates);
      this.roundUpdates += updates.length;
      await this.emit();
    }
  }

  private async runVision(
    post: PostRecord,
    provider: ReturnType<typeof getProvider>,
    settings: { apiKey: string; model: string },
  ): Promise<void> {
    if (!post.thumbnailUrl) return this.markUnclassifiable(post);

    let image: { mediaType: string; base64: string };
    try {
      image = await fetchImageBase64(post.thumbnailUrl);
    } catch {
      // Instagram CDN URLs are time-signed and expire; a dead thumbnail is not an error.
      return this.markUnclassifiable(post);
    }

    const result = await this.callWithRetry(
      () =>
        provider.chat(
          {
            system: SYSTEM_PROMPT,
            user:
              `Categorise this single post from its thumbnail. Use id=0.\n` +
              `${post.handle}${post.altText ? `\nalt text: ${post.altText}` : ''}`,
            image,
            maxTokens: 220,
          },
          settings.apiKey,
          settings.model,
        ),
      provider.models.find((m) => m.id === settings.model),
    );
    if (result === null) return;

    try {
      const parsed = parseJsonLoose<{ results?: ModelResult[] } | ModelResult[]>(result.text);
      const results = Array.isArray(parsed) ? parsed : (parsed.results ?? []);
      const first = results[0];
      if (!first) return;
      await db.update(applyResult(post, first, settings.model));
      this.roundUpdates++;
      await this.emit();
    } catch {
      /* leave pending */
    }
  }

  /**
   * Records that we looked and could not tell, so the post stops cycling through the
   * queue on every round. It still shows in the library, under Uncategorized.
   */
  private async markUnclassifiable(post: PostRecord): Promise<void> {
    await db.update({
      ...post,
      category: null,
      summary: post.altText ?? null,
      categorizedAt: Date.now(),
      modelUsed: 'skipped',
    });
    this.roundUpdates++;
  }

  /**
   * Exponential backoff with jitter on 429/5xx. Returns null when the call should be
   * abandoned — either it is a permanent failure (which sets phase to error) or the run
   * was paused mid-flight.
   *
   * Spend is recorded here rather than at the call sites so that a response we then fail
   * to parse is still counted: the provider billed for it either way.
   */
  private async callWithRetry(
    fn: () => Promise<ChatResult>,
    model: Parameters<typeof usdFor>[0],
  ): Promise<ChatResult | null> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (this.cancelled) return null;
      try {
        const result = await fn();
        await record(result.usage, usdFor(model, result.usage));
        return result;
      } catch (err) {
        const retryable = err instanceof ProviderError && err.retryable;
        if (!retryable || attempt === MAX_ATTEMPTS - 1) {
          this.phase = 'error';
          this.message = redact(err instanceof Error ? err.message : String(err));
          await this.emit();
          return null;
        }
        // 1s, 2s, 4s … plus up to a second of jitter so parallel workers don't
        // synchronise and hit the provider in a burst.
        await sleep(2 ** attempt * 1000 + Math.random() * 1000);
      }
    }
    return null;
  }
}

function applyResult(post: PostRecord, r: ModelResult, model: string): PostRecord {
  return {
    ...post,
    category: normalizeCategory(r.category),
    subcategory: r.subcategory?.trim() || null,
    tags: (r.tags ?? []).slice(0, 4).map((t) => String(t).toLowerCase()),
    summary: r.summary?.trim() || firstLine(post.caption) || null,
    categorizedAt: Date.now(),
    modelUsed: model,
  };
}

function firstLine(caption: string): string {
  const line = caption.split('\n').find((l) => l.trim().length > 0) ?? '';
  return line.trim().slice(0, 120);
}

/**
 * Service workers have no FileReader, so base64 is built by hand. Chunked because
 * String.fromCharCode(...bytes) blows the argument limit on anything non-trivial.
 */
async function fetchImageBase64(url: string): Promise<{ mediaType: string; base64: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Thumbnail fetch failed: ${res.status}`);

  const bytes = new Uint8Array(await res.arrayBuffer());
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }

  const mediaType = (res.headers.get('content-type') ?? 'image/jpeg').split(';')[0]!;
  return { mediaType, base64: btoa(binary) };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

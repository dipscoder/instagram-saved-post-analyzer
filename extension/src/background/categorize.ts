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
 * Tiers 2 and 3 are answered by an analyst (analysts.ts): OpenAI with your own key, or
 * your account when signed in.
 *
 * No transcription yet: Instagram's web payload carries no caption track, so a reel's
 * words would need speech-to-text on its audio, a separate cost left for later.
 */

import * as db from './db';
import { getSettings } from './settings';
import { getSpend, record } from './spend';
import { estimateUsd, getProvider, ProviderError, redact } from './providers/index';
import { accountAnalyst, ownKeyAnalyst, type Analysis, type Analyst } from './analysts';
import { currentUserId } from './account';
import * as ledger from './ledger';
import { fetchThumbnail } from './media';
import { applyVerdict, inputHash, isFresh, verdictFrom } from './ledger';
import { classifyByRules } from '@saved-index/shared/taxonomy';
import {
  applyResult,
  firstLine,
  hasTextSignal,
  signature,
  unclassifiable,
} from './filing';
import type { ReindexQuote } from '../messaging';
import type { IndexProgress, PostRecord } from '../types';

const TEXT_BATCH_SIZE = 25;
const MAX_IN_FLIGHT = 3;
const MAX_ATTEMPTS = 4;
/** Attempts to get an answer for one post before it is set down for this run. */
const MAX_UNANSWERED = 2;




export type ProgressFn = (p: IndexProgress) => void;

export class Categorizer {
  private phase: IndexProgress['phase'] = 'idle';
  private message: string | null = null;
  private running: Promise<void> | null = null;
  private starting: Promise<void> | null = null;
  private cancelled = false;
  /**
   * Records written in the current round. The outer loop re-reads pending work each
   * pass, so a round that writes nothing would hand back an identical queue and spin
   * forever — this is the guard against that.
   */
  private roundUpdates = 0;
  /**
   * How many times this run has asked the model about a post and got nothing back for it.
   * A model that answers for id 0 twenty-five times running still makes progress by the
   * `roundUpdates` test, so that guard alone would let a full library be re-sent — and
   * re-billed — round after round. Two unanswered attempts and the post is set down.
   */
  private readonly unanswered = new Map<string, number>();

  constructor(private readonly onProgress: ProgressFn) {}

  async progress(): Promise<IndexProgress> {
    const [{ total, categorized }, queue, spend, analyst] = await Promise.all([
      db.stats(),
      db.indexQueueStats(),
      getSpend(),
      chooseAnalyst(),
    ]);
    const pending = Math.max(0, total - categorized);
    const estimateCount = queue.remaining > 0 ? queue.remaining : pending;
    return {
      phase: this.phase,
      total,
      categorized,
      pending,
      runTotal: queue.total,
      runCompleted: queue.completed,
      spentUsd: spend.usd,
      estimateUsd: estimateUsd(analyst?.pricing, estimateCount),
      message: this.message,
    };
  }

  /**
   * What re-indexing everything would really cost.
   *
   * The old UI offered "Re-index everything" beside a `$0.00` figure, because the figure
   * was `estimateUsd(model, pending)` and re-index is only offered when `pending` is zero.
   * The button that spends the most money in the product advertised a price of nothing.
   * This counts the posts the ledger genuinely cannot answer for, which after the split is
   * usually a handful rather than the whole library.
   */
  async quoteReindex(): Promise<ReindexQuote> {
    const [records, analyst] = await Promise.all([db.all(), chooseAnalyst()]);
    const billable = await ledger.countStale(
      records.map((post) => ({
        shortcode: post.shortcode,
        inputHash: inputHash(signature(post)),
      })),
    );
    return {
      total: records.length,
      billable,
      usd: estimateUsd(analyst?.pricing, billable),
    };
  }

  isRunning(): boolean {
    return this.phase === 'running';
  }

  /** Paused is a decision the user made. Auto-index must not quietly overrule it. */
  isPaused(): boolean {
    return this.phase === 'paused';
  }

  private stoppedByFailure(): boolean {
    return this.phase === 'error' || this.phase === 'offline';
  }

  pause(): void {
    if (this.phase !== 'running') return;
    this.cancelled = true;
    this.phase = 'paused';
    void this.emit();
  }

  /**
   * Idempotent: calling start twice does not start two loops.
   *
   * The cancellation flag is cleared *before* the early return, not after. `pause()` sets
   * `cancelled` while the loop is still unwinding its current batch, so a user who pressed
   * Resume promptly hit a live `this.running`, returned early, and left `cancelled` set —
   * the loop then saw it and exited. Resume did nothing, and doing it again did nothing.
   */
  async start(): Promise<void> {
    if (this.running) {
      // A prompt Resume can arrive while the paused loop is still unwinding. Restore
      // both the cancellation flag and the visible phase; previously work continued
      // under a button that still said Resume.
      this.cancelled = false;
      this.message = null;
      this.phase = 'running';
      await this.emit();
      return;
    }
    if (this.starting) return this.starting;
    this.starting = this.prepareAndLaunch().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  /** A promise for the active loop, used by callers that need to wait before resetting. */
  completion(): Promise<void> | null {
    return this.running;
  }

  private async prepareAndLaunch(): Promise<void> {
    const queued = await db.indexQueueStats();
    if (queued.remaining === 0) {
      // This is the finish line for the whole run. Anything captured after this snapshot
      // remains pending for the next run instead of moving the target under the user.
      await db.replaceIndexQueue(await db.pendingCategorization(Number.MAX_SAFE_INTEGER));
    }

    this.cancelled = false;
    this.unanswered.clear();
    this.message = null;
    this.phase = 'running';
    await this.emit();

    this.running = this.loop().finally(() => {
      this.running = null;
    });
  }

  /**
   * Re-run categorisation over the whole library.
   *
   * Cheap now, and it did not use to be: `resetCategories` clears the posts' verdicts but
   * the ledger keeps them, so the loop below re-reads its own receipts and only pays for
   * the posts whose input text or taxonomy actually changed. It also retries every post
   * previously set down as unclassifiable, since those are usually expired thumbnails.
   */
  async reindex(): Promise<void> {
    this.pause();
    await this.running?.catch(() => {});
    await db.resetCategories();
    await db.replaceIndexQueue(await db.pendingCategorization(Number.MAX_SAFE_INTEGER));
    await this.start();
  }

  /**
   * Re-run exactly one post at the user's request.
   *
   * `force` bypasses both the paid-work ledger and deterministic rules. Otherwise an
   * incorrectly rule-filed post would replay the same answer forever and the correction
   * control would be cosmetic rather than corrective.
   */
  async reindexOne(shortcode: string): Promise<PostRecord> {
    const post = await db.resetCategory(shortcode);
    const queued = await db.indexQueueStats();
    if (this.running || this.phase === 'paused') {
      await db.appendIndexQueue(shortcode, true);
      if (this.running) await this.emit();
      return post;
    }

    if (queued.remaining > 0) {
      await db.appendIndexQueue(shortcode, true);
      await this.start();
      return post;
    }

    await db.replaceIndexQueue([post], true);
    await this.start();
    return post;
  }

  private async emit(): Promise<void> {
    this.onProgress(await this.progress());
  }

  private async loop(): Promise<void> {
    try {
      // Inside the try: an unrecognised provider id used to throw straight out of the
      // loop, past the only catch, leaving phase stuck on 'running' with an unhandled
      // rejection and a Pause button that did nothing.
      const analyst = await chooseAnalyst();
      if (!analyst) {
        this.phase = 'error';
        this.message = 'Sign in, or connect an OpenAI key in the popup.';
        return void this.emit();
      }

      for (;;) {
        if (this.cancelled) return void this.emit();

        // Read only the frozen run queue. Passive/active capture may keep adding to the
        // library, but those posts belong to the next run.
        const queued = await db.queuedCategorization(500);
        if (!queued.length) break;
        this.roundUpdates = 0;

        // --- tier 0: work already paid for, replayed from the ledger for nothing ---
        const hydrated: PostRecord[] = [];
        const unpaid: PostRecord[] = [];
        const stored = await ledger.getMany(queued.map((row) => row.post.shortcode));

        for (const { post, force } of queued) {
          const verdict = stored.get(post.shortcode);
          if (!force && isFresh(verdict, inputHash(signature(post)))) {
            hydrated.push(applyVerdict(post, verdict));
          } else {
            unpaid.push(post);
          }
        }

        if (hydrated.length) {
          await db.updateMany(hydrated);
          await db.completeIndexQueue(hydrated.map((post) => post.shortcode));
          this.roundUpdates += hydrated.length;
          await this.emit();
        }
        if (!unpaid.length) continue;

        // --- tier 1: free, and it shrinks the LLM workload before we spend anything ---
        const needsModel: PostRecord[] = [];
        const ruled: PostRecord[] = [];
        const forced = new Set(
          queued.filter((row) => row.force).map((row) => row.post.shortcode),
        );

        for (const post of unpaid) {
          const hit = forced.has(post.shortcode) ? null : classifyByRules(post);
          if (hit) {
            ruled.push({
              ...post,
              category: hit.category,
              subcategory: hit.subcategory,
              tags: post.hashtags.slice(0, 4),
              summary: firstLine(post.caption) || firstLine(post.altText ?? '') || hit.category,
              categorizedAt: Date.now(),
              modelUsed: 'rules',
            });
          } else {
            needsModel.push(post);
          }
        }

        if (ruled.length) await this.commit(ruled);

        if (!needsModel.length) continue;

        // --- tiers 2 and 3 ---
        const textPosts = needsModel.filter(hasTextSignal);
        const visionPosts = needsModel.filter((p) => !hasTextSignal(p));

        const jobs: (() => Promise<void>)[] = [];

        for (let i = 0; i < textPosts.length; i += TEXT_BATCH_SIZE) {
          const batch = textPosts.slice(i, i + TEXT_BATCH_SIZE);
          jobs.push(() => this.runTextBatch(batch, analyst));
        }

        for (const post of visionPosts) {
          jobs.push(() =>
            analyst.supportsVision ? this.runVision(post, analyst) : this.markUnclassifiable(post),
          );
        }

        await this.pool(jobs);

        // A rate-limit, auth or network failure sets phase; stop rather than hammering.
        if (this.stoppedByFailure() || this.cancelled) return void this.emit();

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
      while (cursor < jobs.length && !this.cancelled && !this.stoppedByFailure()) {
        const job = jobs[cursor++];
        if (job) await job();
      }
    });
    await Promise.all(workers);
  }

  private async runTextBatch(batch: PostRecord[], analyst: Analyst): Promise<void> {
    const analysis = await this.callWithRetry(() => analyst.analyse(batch.map(signature)));
    // Unreadable is not worth a retry storm; leave the batch pending for next round.
    if (analysis?.results == null) return;
    const results = analysis.results;

    const updates: PostRecord[] = [];
    const answered = new Set<string>();

    for (const r of results) {
      // `r.id` is a number the model chose. Unvalidated, `batch[r.id]` accepted floats,
      // negatives and repeats — and a response that answered "id 0" twenty-five times
      // wrote one post twenty-five times while counting all twenty-five as progress.
      const id = typeof r.id === 'number' ? r.id : Number(r.id);
      if (!Number.isInteger(id) || id < 0 || id >= batch.length) continue;
      const post = batch[id];
      if (!post || answered.has(post.shortcode)) continue;
      answered.add(post.shortcode);
      updates.push(applyResult(post, r, analysis.model));
    }

    // Anything the model was asked about and did not answer for. Left unbounded, a model
    // that reliably answers for only part of a batch re-sends — and re-bills — the rest
    // every round for as long as the run lasts.
    for (const post of batch) {
      if (answered.has(post.shortcode)) continue;
      const misses = (this.unanswered.get(post.shortcode) ?? 0) + 1;
      this.unanswered.set(post.shortcode, misses);
      if (misses >= MAX_UNANSWERED) updates.push(unclassifiable(post));
    }

    if (updates.length) await this.commit(updates);
  }

  private async runVision(post: PostRecord, analyst: Analyst): Promise<void> {
    if (!post.thumbnailUrl) return this.markUnclassifiable(post);

    let image: { mediaType: string; base64: string };
    try {
      image = await fetchImageBase64(post.thumbnailUrl);
    } catch (err) {
      // A time-signed CDN URL that has expired is genuinely final. A dropped connection —
      // a TypeError — is not, and treating the two alike buried whole runs' worth of posts
      // as Uncategorized during a thirty-second wifi outage.
      if (err instanceof TypeError) {
        this.phase = 'offline';
        this.message =
          'Lost the connection while loading a thumbnail. Progress is saved — resume when you are back online.';
        await this.emit();
        return;
      }
      return this.markUnclassifiable(post);
    }

    const analysis = await this.callWithRetry(() => analyst.analyse([signature(post)], image));
    const first = analysis?.results?.[0];
    if (!analysis || !first) return;
    await this.commit([applyResult(post, first, analysis.model)]);
  }

  /**
   * Write a batch of finished posts, ledger first.
   *
   * The order matters and is the cheap direction to fail in: if the worker dies between
   * the two writes, the post stays pending and the verdict is already banked, so the next
   * round replays it for nothing. The other order would lose the thing that was paid for
   * and keep the thing that was free.
   */
  private async commit(posts: PostRecord[]): Promise<void> {
    if (!posts.length) return;
    await ledger.putMany(posts.map((p) => verdictFrom(p, signature(p))));
    await db.updateMany(posts);
    await db.completeIndexQueue(posts.map((p) => p.shortcode));
    this.roundUpdates += posts.length;
    await this.emit();
  }

  /**
   * Records that we looked and could not tell, so the post stops cycling through the
   * queue on every round. It still shows in the library, under Uncategorized.
   *
   * Banked as `modelUsed: 'skipped'`, which the ledger deliberately treats as *not*
   * reusable. Nearly every case here is an expired CDN thumbnail rather than a fact about
   * the post, so a later re-index gets to try again instead of the post being filed under
   * Uncategorized permanently.
   */
  private async markUnclassifiable(post: PostRecord): Promise<void> {
    await this.commit([unclassifiable(post)]);
  }

  /**
   * Exponential backoff with jitter on 429/5xx. Returns null when the call should be
   * abandoned — either it is a permanent failure (which sets phase to error) or the run
   * was paused mid-flight.
   *
   * Spend is recorded here rather than at the call sites so that a response we then fail
   * to parse is still counted: the provider billed for it either way.
   */
  private async callWithRetry(fn: () => Promise<Analysis>): Promise<Analysis | null> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (this.cancelled) return null;
      try {
        const result = await fn();
        // The provider billed for this either way. Letting a storage failure reject here
        // sent us into the catch below, which discards a response already paid for and
        // leaves its whole batch pending to be bought a second time.
        await record(result.usage, result.usd).catch(() => {});
        return result;
      } catch (err) {
        // A dropped connection arrives as a TypeError, not a ProviderError. Treating it
        // as permanent meant a two-second Wi-Fi blip ended an overnight run on its first
        // attempt, with the backoff below never getting a chance to do its job.
        const offline = err instanceof TypeError;
        const retryable = err instanceof ProviderError ? err.retryable : offline;
        if (!retryable || attempt === MAX_ATTEMPTS - 1) {
          this.phase = offline ? 'offline' : 'error';
          this.message = offline
            ? 'Lost the connection to the provider. Progress is saved — press resume when you are back online.'
            : redact(err instanceof Error ? err.message : String(err));
          await this.emit();
          return null;
        }
        // 1s, 2s, 4s … plus up to a second of jitter so parallel workers don't
        // synchronise and hit the provider in a burst. A provider that told us exactly
        // how long to wait is believed instead: three retries inside a 60-second cooldown
        // burn the attempt budget seven seconds in and abandon the run for nothing.
        const stated = err instanceof ProviderError ? err.retryAfterMs : null;
        await sleep(stated ?? 2 ** attempt * 1000 + Math.random() * 1000);
      }
    }
    return null;
  }
}

/**
 * Signed in, posts are filed by the account, which pays from its own key. Otherwise by
 * OpenAI with the key saved here. Null when neither is set up.
 */
async function chooseAnalyst(): Promise<Analyst | null> {
  if (await currentUserId()) return accountAnalyst();
  const settings = await getSettings();
  return settings.apiKey
    ? ownKeyAnalyst(getProvider(settings.provider), settings.apiKey, settings.model)
    : null;
}

/** Whether anything can answer for a post right now: an account or a saved key. */
export async function canIndex(): Promise<boolean> {
  return (await chooseAnalyst()) !== null;
}

/**
 * Service workers have no FileReader, so base64 is built by hand. Chunked because
 * String.fromCharCode(...bytes) blows the argument limit on anything non-trivial.
 */
async function fetchImageBase64(url: string): Promise<{ mediaType: string; base64: string }> {
  const image = await fetchThumbnail(url);
  const bytes = new Uint8Array(await image.arrayBuffer());
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return { mediaType: image.type || 'image/jpeg', base64: btoa(binary) };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

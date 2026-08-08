/**
 * What indexing has actually cost.
 *
 * Every provider returns token counts on its response, so this is metered rather than
 * estimated: `usdFor()` multiplies the reported usage by the model's published list
 * price. The estimate shown before a run is a separate, deliberately pessimistic figure
 * (see `estimateUsd`) — this is the number that grows as work happens.
 *
 * Lives in `storage.local` rather than IndexedDB because it is a handful of integers and
 * has to survive the service worker being killed between batches.
 */

import type { Usage } from './providers/index';

const KEY = 'spend';

export interface Spend {
  usd: number;
  inputTokens: number;
  outputTokens: number;
  /** Model calls billed. Rule-matched posts cost nothing and are not counted. */
  calls: number;
  /** Epoch ms of the first billed call, so the UI can say what window this covers. */
  since: number | null;
}

const EMPTY: Spend = { usd: 0, inputTokens: 0, outputTokens: 0, calls: 0, since: null };

/**
 * Up to MAX_IN_FLIGHT calls finish at once, and a read-modify-write on storage would
 * drop increments if they interleaved. Chaining onto the previous write serialises them.
 */
let queue: Promise<Spend> = Promise.resolve(EMPTY);

export async function getSpend(): Promise<Spend> {
  const stored = await chrome.storage.local.get(KEY);
  return { ...EMPTY, ...(stored[KEY] as Partial<Spend> | undefined) };
}

export function record(usage: Usage, usd: number): Promise<Spend> {
  queue = queue.then(async () => {
    const current = await getSpend();
    const next: Spend = {
      usd: current.usd + usd,
      inputTokens: current.inputTokens + usage.inputTokens,
      outputTokens: current.outputTokens + usage.outputTokens,
      calls: current.calls + 1,
      since: current.since ?? Date.now(),
    };
    await chrome.storage.local.set({ [KEY]: next });
    return next;
  });
  return queue;
}

export async function resetSpend(): Promise<void> {
  queue = queue.then(async () => {
    await chrome.storage.local.set({ [KEY]: EMPTY });
    return EMPTY;
  });
  await queue;
}

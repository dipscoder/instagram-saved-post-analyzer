/**
 * Save order, reconstructed from the only thing Instagram actually tells us.
 *
 * There is no save timestamp anywhere in the saved feed — not in the REST shape, not in
 * the GraphQL one. What there *is* is order: the feed comes back newest-saved first. That
 * answers "what did I save recently?" exactly, and only fails to answer "on what date?",
 * which we therefore don't claim to know.
 *
 * Turning arrival order into a sort key takes one wrinkle. Within a single visit to the
 * saved grid, earlier arrival means more recently saved — the feed's own order. But a
 * *later* visit sees posts the earlier one couldn't, and those are newer than everything
 * before them, so a plain running counter would file them last. So each visit gets a
 * session number, and the key folds both:
 *
 *     rank = session * STRIDE - positionInSession
 *
 * Sorted descending that reads: latest visit first, and within a visit, feed order. A
 * post already in the database keeps the rank it was first given, so a re-sweep re-walks
 * the whole feed without shuffling anything.
 *
 * The one case it gets wrong: saving a post and returning to the grid without a page
 * load, in the same visit. It files below the backlog until the next load. Living with
 * that is cheaper than the alternatives, all of which involve guessing.
 */

const KEY = 'captureCursor';

/** Positions available per visit. A million saved posts is not a real number. */
const STRIDE = 1_000_000;

interface Visit {
  session: number;
  seq: number;
}

/**
 * One entry per recent page load, rather than one global cursor.
 *
 * A single cursor keyed on "the last pageId I saw" looked right with one tab and inverted
 * the whole library with two: pressing Index now broadcasts to every open saved tab, both
 * sweep at once, and their messages interleave. Each alternation counted as a new visit —
 * bumping the session by a full STRIDE and resetting the position to zero — so ranks grew
 * with depth into the feed, which is precisely backwards. Keeping a handful of visits
 * addressable at once makes interleaving a non-event.
 */
interface Cursor {
  visits: Record<string, Visit>;
  lastSession: number;
}

/** Enough for a couple of tabs plus the one before them. Old entries are just dropped. */
const MAX_TRACKED_VISITS = 4;

/**
 * Reservations have to be serialised: two capture messages landing together would
 * otherwise both read the same `seq` and hand out the same ranks. Same shape as
 * spend.ts — the chain recovers from a rejection so one storage failure doesn't
 * permanently wedge ordering.
 */
let queue: Promise<number[]> = Promise.resolve([]);

export function reserveRanks(pageId: string, count: number): Promise<number[]> {
  const run = (): Promise<number[]> => reserve(pageId, count);
  queue = queue.then(run, run);
  return queue;
}

async function reserve(pageId: string, count: number): Promise<number[]> {
  if (count <= 0) return [];

  const stored = (await chrome.storage.local.get(KEY))[KEY] as Partial<Cursor> | undefined;
  const visits: Record<string, Visit> = { ...stored?.visits };
  let lastSession = stored?.lastSession ?? 0;

  let visit = visits[pageId];
  if (!visit) {
    visit = { session: ++lastSession, seq: 0 };
    visits[pageId] = visit;
  }

  const ranks: number[] = [];
  for (let i = 0; i < count; i++) {
    ranks.push(visit.session * STRIDE - Math.min(visit.seq + i, STRIDE - 1));
  }
  visit.seq = Math.min(visit.seq + count, STRIDE - 1);

  // Keep only the most recent few, newest session first, so the record stays small.
  const kept = Object.entries(visits)
    .sort(([, a], [, b]) => b.session - a.session)
    .slice(0, MAX_TRACKED_VISITS);

  await chrome.storage.local.set({
    [KEY]: { visits: Object.fromEntries(kept), lastSession } satisfies Cursor,
  });
  return ranks;
}

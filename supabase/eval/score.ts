/**
 * Scoring for the filing eval. Pure, so `npm run verify` checks it.
 *
 * Three outcomes matter, and they are not equally bad:
 *   right    the post is under the category a person would look in
 *   unknown  the post is under Unknown: findable by search, never misleading
 *   wrong    the post is under another category, where nobody will look for it
 * A wrong answer is the expensive mistake, so it is reported on its own rather than folded
 * into accuracy. A post labeled null is one too thin to place: Unknown is right for it.
 */

export interface Labeled {
  id: string;
  handle: string;
  caption: string;
  hashtags: string[];
  /** The category a person would file it under, or null when nobody could tell. */
  expected: string | null;
  note?: string;
}

export interface Outcome {
  id: string;
  expected: string | null;
  got: string | null;
  /** Filed by the free keyword rules rather than the model. */
  byRules: boolean;
}

export interface Score {
  total: number;
  right: number;
  unknown: number;
  wrong: number;
  /** right / total. */
  accuracy: number;
  /** Of the posts given a category, how many got the right one. */
  precision: number;
  byRules: number;
  mistakes: Outcome[];
}

export function verdictOf(o: Outcome): 'right' | 'unknown' | 'wrong' {
  if (o.got === o.expected) return 'right';
  if (o.got === null) return 'unknown';
  return 'wrong';
}

export function score(outcomes: Outcome[]): Score {
  const s: Score = { total: outcomes.length, right: 0, unknown: 0, wrong: 0, accuracy: 0, precision: 0, byRules: 0, mistakes: [] };
  for (const o of outcomes) {
    const v = verdictOf(o);
    s[v]++;
    if (o.byRules) s.byRules++;
    if (v !== 'right') s.mistakes.push(o);
  }
  s.accuracy = s.total ? s.right / s.total : 0;
  const placed = outcomes.filter((o) => o.got !== null);
  s.precision = placed.length ? placed.filter((o) => o.got === o.expected).length / placed.length : 0;
  return s;
}

export function report(s: Score, usd: number): string {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const lines = [
    `posts      ${s.total}`,
    `right      ${s.right}  (${pct(s.accuracy)})`,
    `unknown    ${s.unknown}`,
    `wrong      ${s.wrong}  ← filed where nobody will look`,
    `precision  ${pct(s.precision)}  of posts given a category`,
    `by rules   ${s.byRules}  (free)`,
    `cost       $${usd.toFixed(4)}`,
  ];
  if (s.mistakes.length) {
    lines.push('', 'mistakes:');
    for (const m of s.mistakes) lines.push(`  ${m.id.padEnd(12)} expected ${m.expected ?? 'Unknown'}, got ${m.got ?? 'Unknown'}${m.byRules ? ' (rules)' : ''}`);
  }
  return lines.join('\n');
}

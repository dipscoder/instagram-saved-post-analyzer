/**
 * `npm run eval`: files every post in labeled.json exactly as the `sort` function does
 * (keyword rules first, then the Decisions API and the summary call together) and reports
 * how many land in the right category.
 *
 *   npm run eval                 rules only, free, no key needed
 *   OPENAI_API_KEY=… npm run eval -- --model
 *                                the full pipeline; costs about a tenth of a cent
 *
 * The key is read from the environment of your own shell and sent only to OpenAI. Never
 * put it in a file in this repository.
 */

import { filedFromResult, signature, type FilingInput, type ModelResult } from '@saved-index/shared/filing';
import { classifyByRules, UNCATEGORIZED } from '@saved-index/shared/taxonomy';
import {
  combine,
  costUsd,
  decisionsBody,
  MAX_POSTS,
  readDecisions,
  readSummaries,
  summaryBody,
  usageOf,
  type AnalyzeRequest,
} from '../functions/analyze/decide';
import labeled from './labeled.json';
import { report, score, type Labeled, type Outcome } from './score';

declare const process: { argv: string[]; env: Record<string, string | undefined>; exit(code: number): never };

const posts = labeled.posts as Labeled[];
const useModel = process.argv.includes('--model');
const key = process.env['OPENAI_API_KEY'];
if (useModel && !key) {
  console.error('Set OPENAI_API_KEY in your shell to run the model. Rules only: npm run eval');
  process.exit(1);
}

const input = (p: Labeled): FilingInput => ({
  handle: p.handle,
  caption: p.caption,
  hashtags: p.hashtags,
  altText: null,
  isVideo: false,
  durationSec: null,
  audioTrackName: null,
});
const asCategory = (c: string | null) => (c && c !== UNCATEGORIZED ? c : null);

const outcomes: Outcome[] = [];
const forModel: Labeled[] = [];
for (const p of posts) {
  const hit = classifyByRules(input(p));
  if (hit) outcomes.push({ id: p.id, expected: p.expected, got: asCategory(hit.category), byRules: true });
  else if (useModel) forModel.push(p);
  else outcomes.push({ id: p.id, expected: p.expected, got: null, byRules: false });
}

let usd = 0;
for (let i = 0; i < forModel.length; i += MAX_POSTS) {
  const batch = forModel.slice(i, i + MAX_POSTS);
  const req: AnalyzeRequest = { posts: batch.map((p, id) => ({ id, text: signature(input(p)) })) };
  const [decisions, summaries] = await Promise.all([call('decisions', decisionsBody(req)), call('responses', summaryBody(req))]);
  usd += costUsd(usageOf(decisions), usageOf(summaries));
  const results = new Map<number, ModelResult>(combine(req, readDecisions(decisions), readSummaries(summaries)).map((r) => [r.id, r]));
  batch.forEach((p, id) => {
    const r = results.get(id);
    outcomes.push({ id: p.id, expected: p.expected, got: r ? asCategory(filedFromResult(input(p), r).category) : null, byRules: false });
  });
}

console.log(useModel ? 'Full pipeline: rules, then the model\n' : 'Rules only (free). Add --model for the full pipeline.\n');
console.log(report(score(outcomes), usd));

async function call(endpoint: string, body: object): Promise<unknown> {
  const res = await fetch(`https://api.openai.com/v1/${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(`OpenAI ${endpoint} ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return null;
  }
  return res.json();
}

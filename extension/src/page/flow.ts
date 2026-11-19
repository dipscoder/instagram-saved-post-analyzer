/**
 * The one indexing button, as pure functions so `npm run verify` can pin its behaviour.
 *
 * Two jobs, never mixed: **finding** posts scrolls the collection so Instagram loads them,
 * and **indexing** sends found posts to be filed by topic with a summary. The button only
 * ever does what its label says. Finding hands over to indexing by itself when it reaches
 * the end, so the usual path is one press. Indexing never scrolls.
 */

import type { IndexProgress } from '../types';

export type FlowAction = 'pause' | 'index' | 'find';

export interface FlowButton {
  action: FlowAction;
  label: string;
}

export function flowButton(p: IndexProgress, finding: boolean): FlowButton {
  if (finding || p.phase === 'running') return { action: 'pause', label: 'Pause' };
  if (p.pending > 0) {
    const resuming = (p.phase === 'paused' || p.phase === 'error') && p.runCompleted < p.runTotal;
    return { action: 'index', label: resuming ? 'Resume indexing' : `Index ${posts(p.pending)}` };
  }
  return { action: 'find', label: 'Find new posts' };
}

/** What is happening right now, in a few words. */
export function flowStatus(p: IndexProgress, finding: boolean): string {
  if (finding) return p.pending > 0 ? `Finding posts · ${p.pending} to index` : 'Finding posts…';
  if (p.phase === 'running') return `Indexing ${p.runCompleted} of ${p.runTotal}`;
  if (p.phase === 'error') return p.message ?? 'Indexing stopped';
  if (p.phase === 'paused') {
    if (p.message) return p.message;
    if (p.runCompleted < p.runTotal) return `Paused · ${p.runCompleted} of ${p.runTotal} indexed`;
  }
  if (p.pending > 0) return `${posts(p.pending)} found, not indexed yet`;
  if (p.total === 0) return 'No posts found yet';
  return `${posts(p.total)}, all indexed`;
}

function posts(n: number): string {
  return `${n} post${n === 1 ? '' : 's'}`;
}

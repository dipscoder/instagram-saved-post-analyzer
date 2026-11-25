/**
 * The pill's one button, as pure functions so `npm run verify` can pin its behaviour.
 *
 * The extension only collects: it finds posts by scrolling the open collection and syncs
 * them to the account. Organising, and every other control, lives in the web app.
 */

export type PillAction = 'find' | 'stop' | 'remove' | 'confirm-remove';

export interface PillState {
  finding: boolean;
  /** Posts this browser has found, in total. */
  total: number;
  /** Posts the last complete sweep of the full feed did not see again. */
  strays: number;
  /** The first Remove press arms it; the second removes. */
  confirming: boolean;
  /** Something only this page knows, such as Instagram rate-limiting the scroll. */
  message: string | null;
  /** New posts the last finished sweep on this page found; null before one finishes. */
  lastFound: number | null;
}

export interface PillButton {
  action: PillAction;
  label: string;
}

export function pillButton(s: PillState): PillButton {
  if (s.finding) return { action: 'stop', label: 'Stop' };
  if (s.strays > 0) {
    return s.confirming
      ? { action: 'confirm-remove', label: `Confirm, remove ${s.strays}` }
      : { action: 'remove', label: `Remove ${s.strays}` };
  }
  return { action: 'find', label: 'Find new posts' };
}

/** What is happening right now, in a few words. */
export function pillStatus(s: PillState): string {
  if (s.finding) return `Finding posts · ${posts(s.total)} so far`;
  if (s.message) return s.message;
  if (s.strays > 0) return `${posts(s.strays)} no longer saved on Instagram`;
  if (s.lastFound === 0) return 'Done · no new saves since last time';
  if (s.lastFound !== null) return `Done · ${s.lastFound.toLocaleString('en-US')} new ${s.lastFound === 1 ? 'post' : 'posts'}, sent to your library`;
  if (s.total === 0) return 'Press Find new posts to start';
  return `${posts(s.total)} found · synced to your library`;
}

/**
 * The link to the web app. After a sweep that found something, it names the next step,
 * which happens there.
 */
export function pillLink(s: PillState): string {
  return !s.finding && s.lastFound ? 'Organise them ↗' : 'Open library ↗';
}

function posts(n: number): string {
  return `${n.toLocaleString('en-US')} post${n === 1 ? '' : 's'}`;
}

/**
 * Popup: the extension is a collector, so this is small on purpose.
 *
 *   signed out — create an account or sign in. Nothing else works without one.
 *   signed in  — who you are and when you last synced, what finding has found, one button
 *                to find new posts, and the way into the web app, where the library and
 *                every other control live.
 *
 * Credentials go straight to the worker and are never kept here.
 */

import { send, subscribe, type AccountState } from '../messaging';
import { WEB_APP_URL } from '../config';
import type { Settings, Theme } from '../types';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
};

let account: AccountState | null = null;
let found = 0;
let finding = false;
/** Someone who has signed in here before is far likelier to be signing in than signing up. */
let accountMode: 'sign-up' | 'sign-in' = remembered('signedInBefore') ? 'sign-in' : 'sign-up';

// Before anything awaits, so a dark popup never opens white first.
applyTheme(cachedTheme());
void init();

async function init(): Promise<void> {
  $<HTMLAnchorElement>('openWeb').href = WEB_APP_URL;
  wire();
  setAccountMode(accountMode);
  try {
    applyTheme((await send<Settings>({ type: 'settings:get' })).theme);
    account = await send<AccountState>({ type: 'account:get' });
  } catch {
    // Both screens are hidden until one is switched on, so say so rather than show nothing.
    $('setup').classList.add('on');
    setStatus('accountStatus', 'bad', 'The extension is not responding. Reopen this popup.');
    return;
  }
  await refresh();
  subscribe((msg) => {
    if (msg.type === 'settings') applyTheme(msg.settings.theme);
    else if (msg.type === 'harvest') finding = msg.action === 'start';
    else if (msg.type === 'found') found = msg.total;
    else return;
    render();
  });
}

function wire(): void {
  $('themeBtn').addEventListener('click', () => {
    const next: Theme = document.documentElement.dataset['theme'] === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    void send({ type: 'theme:set', theme: next }).catch(() => {});
  });
  $('modeUp').addEventListener('click', () => setAccountMode('sign-up'));
  $('modeIn').addEventListener('click', () => setAccountMode('sign-in'));
  $<HTMLFormElement>('signedOut').addEventListener('submit', (e) => {
    e.preventDefault();
    void onAccount(accountMode === 'sign-up' ? 'account:sign-up' : 'account:sign-in');
  });
  $('signOut').addEventListener('click', () => void onAccount('account:sign-out'));
  $('primary').addEventListener('click', () => void onPrimary());
}

async function refresh(): Promise<void> {
  try {
    found = await send<number>({ type: 'posts:count' });
  } catch {
    setStatus('homeStatus', 'bad', 'Could not reach the extension. Reopen this popup.');
  }
  render();
}

// --- account ----------------------------------------------------------------

function setAccountMode(mode: typeof accountMode): void {
  accountMode = mode;
  const signUp = mode === 'sign-up';
  $('modeUp').setAttribute('aria-pressed', String(signUp));
  $('modeIn').setAttribute('aria-pressed', String(!signUp));
  $('accountSubmit').textContent = signUp ? 'Create Account' : 'Sign In';
  const password = $<HTMLInputElement>('password');
  password.autocomplete = signUp ? 'new-password' : 'current-password';
  password.placeholder = signUp ? 'Password, 8 or more characters' : 'Password';
  setStatus('accountStatus', '', '');
}

type AccountRequest = 'account:sign-in' | 'account:sign-up' | 'account:sign-out';

async function onAccount(type: AccountRequest): Promise<void> {
  const signingOut = type === 'account:sign-out';
  setStatus(signingOut ? 'homeStatus' : 'accountStatus', '', signingOut ? 'Signing out…' : 'One moment…');
  try {
    const credentials = {
      email: $<HTMLInputElement>('email').value,
      password: $<HTMLInputElement>('password').value,
    };
    account = await send<AccountState>(signingOut ? { type } : { type, ...credentials });
    $<HTMLInputElement>('password').value = '';
    if (account.email) remember('signedInBefore');
    setStatus('homeStatus', '', '');
    if (account.confirmEmail) {
      // Only when the Supabase project still asks for confirmation; see supabase/README.md.
      setAccountMode('sign-in');
      setStatus('accountStatus', 'ok', 'Almost there. Open the link we just emailed you, then sign in here.');
    }
    await refresh();
  } catch (err) {
    setStatus(signingOut ? 'homeStatus' : 'accountStatus', 'bad', message(err));
  }
}

// --- finding ----------------------------------------------------------------

/**
 * Finding scrolls a saved collection on Instagram, so it needs one open. If none is, the
 * saved feed the extension last saw opens in a new tab and starts scrolling when it loads.
 */
async function onPrimary(): Promise<void> {
  try {
    if (finding) {
      await send({ type: 'find:stop' });
      finding = false;
      return render();
    }
    await send({ type: 'find:start' });
    finding = true;
    const open = await chrome.tabs.query({ url: 'https://www.instagram.com/*/saved/*' });
    if (open.length === 0) await chrome.tabs.create({ url: await send<string>({ type: 'library:url' }) });
    setStatus('homeStatus', '', 'Scrolling your saved posts on Instagram. Keep that tab open.');
  } catch (err) {
    setStatus('homeStatus', 'bad', message(err));
  }
  render();
}

// --- render -----------------------------------------------------------------

function render(): void {
  const signedIn = account?.email != null;
  $('setup').classList.toggle('on', !signedIn);
  $('home').classList.toggle('on', signedIn);
  if (!account || !signedIn) return;

  $('accountEmail').textContent = account.email ?? '';
  $('avatar').textContent = account.email?.[0]?.toUpperCase() ?? '';
  $('accountSync').textContent = account.error
    ? 'Sync failed, retrying'
    : account.lastSyncAt
      ? `Synced ${timeAgo(account.lastSyncAt)}`
      : 'Not synced yet';
  if (account.error) $('accountSync').title = account.error;

  $('homeTitle').textContent = finding
    ? 'Finding posts…'
    : found === 0
      ? 'Nothing found yet'
      : `${found.toLocaleString()} post${found === 1 ? '' : 's'} found`;
  $('homeBody').textContent = finding
    ? `${found.toLocaleString()} so far. They appear in your library as they sync.`
    : found === 0
      ? 'Press Find new posts and the extension scrolls your saved posts on Instagram for you.'
      : 'Find again after saving more. Index and search them in your library.';
  $('primary').textContent = finding ? 'Stop' : 'Find new posts';
}

function setStatus(id: string, kind: '' | 'ok' | 'bad', text: string): void {
  const el = $(id);
  el.className = `status${kind ? ` ${kind}` : ''}`;
  const msg = el.querySelector('.msg');
  if (msg) msg.textContent = text;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Light or dark, on <html>. The setting lives in the worker; this copy in localStorage
 * only exists so the popup can paint in the right colours before the worker answers.
 */
function applyTheme(theme: Theme | undefined): void {
  const next: Theme = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset['theme'] = next;
  const btn = document.getElementById('themeBtn');
  if (btn) {
    btn.title = next === 'dark' ? 'Switch to light' : 'Switch to dark';
    btn.setAttribute('aria-label', btn.title);
  }
  try {
    localStorage.setItem('theme', next);
  } catch {
    // The worker's copy is the real one.
  }
}

function cachedTheme(): Theme {
  try {
    return localStorage.getItem('theme') === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function remembered(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function remember(key: string): void {
  try {
    localStorage.setItem(key, '1');
  } catch {
    // Nothing to do: the default is still usable.
  }
}

function timeAgo(ms: number): string {
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

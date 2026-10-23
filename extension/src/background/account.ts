/**
 * The user's Saved Index account, held by the service worker.
 *
 * The session (access and refresh tokens) is a credential, so it is treated like the API
 * key: it lives in `chrome.storage.local`, which `lockDownStorage()` restricts to trusted
 * contexts, and only the signed-in email ever leaves the worker.
 */

import { createClient, type SupportedStorage } from '@supabase/supabase-js';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../config';

/** supabase-js expects localStorage, which a service worker does not have. */
const chromeStorage: SupportedStorage = {
  async getItem(key) {
    const stored = await chrome.storage.local.get(key);
    return typeof stored[key] === 'string' ? stored[key] : null;
  },
  setItem: (key, value) => chrome.storage.local.set({ [key]: value }),
  removeItem: (key) => chrome.storage.local.remove(key),
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: chromeStorage,
    storageKey: 'account',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

export interface Account {
  email: string | null;
}

/** The signed-in user's id, or null. Refreshes an expired session as a side effect. */
export async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

export async function getAccount(): Promise<Account> {
  const { data } = await supabase.auth.getSession();
  return { email: data.session?.user.email ?? null };
}

export async function signIn(email: string, password: string): Promise<Account> {
  const { data, error } = await supabase.auth.signInWithPassword(credentials(email, password));
  if (error) throw new Error(error.message);
  return { email: data.user.email ?? null };
}

/**
 * Creates the account. When the project requires email confirmation there is no session
 * yet, and the caller is told to confirm before signing in.
 */
export async function signUp(email: string, password: string): Promise<Account & { confirm: boolean }> {
  const { data, error } = await supabase.auth.signUp(credentials(email, password));
  if (error) throw new Error(error.message);
  return { email: data.session?.user.email ?? null, confirm: !data.session };
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error(error.message);
}

function credentials(email: unknown, password: unknown): { email: string; password: string } {
  const e = String(email ?? '').trim().slice(0, 320);
  const p = String(password ?? '').slice(0, 200);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Error('Enter a valid email address.');
  if (p.length < 8) throw new Error('Use a password of at least 8 characters.');
  return { email: e, password: p };
}

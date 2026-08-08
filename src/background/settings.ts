/**
 * Settings, including the API key.
 *
 * `chrome.storage.local` is readable by content scripts **by default**. Since one of our
 * content scripts runs on instagram.com — a page whose own JS we do not control — the key
 * would otherwise sit one `chrome.storage.local.get()` away from any ISOLATED-world code
 * on that origin. `setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })` closes that:
 * afterwards only extension pages and the service worker can read the area.
 *
 * It is asserted on every service-worker start, not just on install. The setting is
 * per-storage-area and the call is cheap; re-asserting means a profile that somehow lost
 * it (older build, manual reset) self-heals on the next wake.
 */

import { DEFAULT_SETTINGS, type Settings } from '../types';
import type { SafeSettings } from '../messaging';

const KEY = 'settings';

export async function lockDownStorage(): Promise<void> {
  try {
    await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  } catch (err) {
    // Available since Chrome 102 for session, and for local in current Chrome. If it is
    // ever missing, fail loudly in the log — the key would be content-script readable.
    console.error(
      '[saved-index] Could not restrict storage.local to trusted contexts. ' +
        'The API key may be readable by content scripts on instagram.com.',
      err,
    );
  }
}

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(KEY);
  const raw = stored[KEY] as Partial<Settings> | undefined;
  const merged = { ...DEFAULT_SETTINGS, ...raw };
  // 'thin' was the old name for the overlay control bar. Migrate on read so an existing
  // profile doesn't end up with a value the video code no longer understands.
  if ((merged.scrubberSkin as string) === 'thin') merged.scrubberSkin = 'overlay';
  return merged;
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}

/** Wipe the key and nothing else — captured posts and their categories are untouched. */
export async function clearKey(): Promise<Settings> {
  return setSettings({ apiKey: '' });
}

/** The only settings shape allowed to cross into a content script or the popup. */
export async function getSafeSettings(): Promise<SafeSettings> {
  const { apiKey, ...rest } = await getSettings();
  return { ...rest, keyMask: maskKey(apiKey), hasKey: apiKey.length > 0 };
}

/**
 * `sk-ant-a…9f2c` — enough to tell two keys apart and to match against the provider
 * console, useless to steal. Rendered as plain text; it must never go back into a
 * password field, which is what made the mask look like a row of dots.
 */
export function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 12) return '•'.repeat(key.length);
  return `${key.slice(0, 8)}…${key.slice(-4)}`;
}

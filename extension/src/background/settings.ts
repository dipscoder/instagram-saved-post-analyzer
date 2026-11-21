/**
 * Appearance settings, and the lock on the storage area that also holds the account
 * session.
 *
 * `chrome.storage.local` is readable by content scripts **by default**. Since one of our
 * content scripts runs on instagram.com — a page whose own JS we do not control — the
 * session's access and refresh tokens would otherwise sit one `chrome.storage.local.get()`
 * away from any ISOLATED-world code on that origin. `setAccessLevel({ accessLevel:
 * 'TRUSTED_CONTEXTS' })` closes that: afterwards only extension pages and the service
 * worker can read the area.
 *
 * It is asserted on every service-worker start, not just on install. The setting is
 * per-storage-area and the call is cheap; re-asserting means a profile that somehow lost
 * it (older build, manual reset) self-heals on the next wake.
 */

import { DEFAULT_SETTINGS, SETTINGS_VERSION, type Settings } from '../types';

const KEY = 'settings';

export async function lockDownStorage(): Promise<void> {
  try {
    await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  } catch (err) {
    // Available since Chrome 102 for session, and for local in current Chrome. If it is
    // ever missing, fail loudly in the log — the session would be content-script readable.
    console.error(
      '[saved-index] Could not restrict storage.local to trusted contexts. ' +
        'The account session may be readable by content scripts on instagram.com.',
      err,
    );
  }
}

/**
 * Pure, idempotent, and applied on every read so a stored value never reaches the rest of
 * the code in a shape it doesn't understand. Only the fields `Settings` declares survive.
 *
 * **v1 → v2 (video controls).** `'thin'` was renamed `'overlay'`. More importantly,
 * `'native'` stopped being the default — and a profile still holding it almost certainly
 * *inherited* it rather than chose it, because the old build shipped it as the default and
 * wrote the whole settings object back on any unrelated change, so there is no way to tell
 * the two apart. Native controls are precisely the ones Instagram's click-catcher swallows,
 * which is the entire reason the overlay bar exists. Reset once; the toggle still wins
 * afterwards because a later write carries the current version.
 *
 * **v2 → v3 (collector only).** The extension stopped indexing, so the provider, model,
 * auto-index flag and the user's own OpenAI key are dropped. Dropping is the point: a key
 * nothing reads should not stay in the browser.
 */
export function migrate(raw: Partial<Settings> | undefined): Settings {
  let scrubberSkin: string = raw?.scrubberSkin ?? DEFAULT_SETTINGS.scrubberSkin;
  if ((raw?.settingsVersion ?? 1) < 2) scrubberSkin = DEFAULT_SETTINGS.scrubberSkin;
  return {
    scrubberSkin: scrubberSkin === 'native' ? 'native' : 'overlay',
    theme: raw?.theme === 'dark' ? 'dark' : 'light',
    settingsVersion: SETTINGS_VERSION,
  };
}

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(KEY);
  return migrate(stored[KEY] as Partial<Settings> | undefined);
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = migrate({ ...(await getSettings()), ...patch });
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}

/**
 * Persist the migrated shape, so whatever an older build stored (its OpenAI key included)
 * is actually gone from storage rather than merely ignored on read.
 */
export async function migrateSettings(): Promise<void> {
  await setSettings({});
}

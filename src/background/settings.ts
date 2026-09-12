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

import { DEFAULT_SETTINGS, SETTINGS_VERSION, type Settings } from '../types';
import { PROVIDERS } from './providers/index';
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

/**
 * Pure, idempotent, and applied on every read so a stored value never reaches the rest of
 * the code in a shape it doesn't understand.
 *
 * **v1 → v2 (video controls).** `'thin'` was renamed `'overlay'`. More importantly,
 * `'native'` stopped being the default — and a profile still holding it almost certainly
 * *inherited* it rather than chose it, because the old build shipped it as the default and
 * wrote the whole settings object back on any unrelated change, so there is no way to tell
 * the two apart. Native controls are precisely the ones Instagram's click-catcher swallows,
 * which is the entire reason the overlay bar exists, so leaving those profiles alone means
 * leaving them with controls that cannot work. Reset once; the toggle still wins afterwards
 * because a later write carries `settingsVersion: 2`.
 */
export function migrate(raw: Partial<Settings> | undefined): Settings {
  const next = { ...DEFAULT_SETTINGS, ...raw };

  if ((raw?.settingsVersion ?? 1) < 2) {
    next.scrubberSkin = DEFAULT_SETTINGS.scrubberSkin;
  }
  if ((next.scrubberSkin as string) === 'thin') next.scrubberSkin = 'overlay';

  // A provider or model that no longer exists is not a harmless stale string. An unknown
  // provider threw out of the categoriser's loop; an unknown model made `usdFor` return 0,
  // so real calls were billed while the popup reported the run as costing $0.00.
  const provider = PROVIDERS[next.provider] ?? PROVIDERS[DEFAULT_SETTINGS.provider];
  next.provider = provider.id;
  if (!provider.models.some((m) => m.id === next.model)) {
    next.model = provider.models[0]?.id ?? DEFAULT_SETTINGS.model;
  }

  next.settingsVersion = SETTINGS_VERSION;
  return next;
}

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(KEY);
  return migrate(stored[KEY] as Partial<Settings> | undefined);
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = migrate({ ...(await getSettings()), ...patch });
  next.apiKey = typeof next.apiKey === 'string' ? next.apiKey.trim().slice(0, 500) : '';
  next.autoIndex = Boolean(next.autoIndex);
  next.scrubberSkin = next.scrubberSkin === 'native' ? 'native' : 'overlay';
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}

/**
 * Persist the migrated shape. Reads are already migrated, but content scripts learn about
 * changes through `storage.onChanged`, which reports the raw stored value — so the
 * migration has to actually land in storage for a page that is already open to see it.
 */
export async function migrateSettings(): Promise<void> {
  await setSettings({});
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

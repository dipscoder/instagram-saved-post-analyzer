/**
 * ISOLATED-world content script on instagram.com. Entry point for everything on-page.
 *
 * Runs at document_start so the capture bridge is listening before the MAIN-world patch
 * starts posting. UI work waits for a body to attach to.
 */

import { startBridge } from './capture/bridge';
import { isLibraryMounted, mountLibrary, unmountLibrary } from './page/library';
import { setScrubberSkin, startVideoControls } from './page/video';
import { send, type SafeSettings } from './messaging';

startBridge();

whenBodyReady(() => {
  void boot();
});

async function boot(): Promise<void> {
  let settings: SafeSettings | null = null;
  try {
    const res = await send<{ settings: SafeSettings }>({ type: 'settings:get' });
    settings = res.settings;
  } catch {
    // Service worker still waking. Video controls are worth having regardless.
  }

  startVideoControls(settings?.scrubberSkin ?? 'native');
  syncLibraryToRoute();
  watchRouteChanges();

  // Keep the scrubber skin in step with the settings toggle without a reload.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes['settings']) return;
    const next = changes['settings'].newValue as { scrubberSkin?: 'native' | 'thin' } | undefined;
    if (next?.scrubberSkin) setScrubberSkin(next.scrubberSkin);
  });
}

/** The saved grid lives at /{username}/saved/… and sometimes /saved/…. */
function isSavedRoute(): boolean {
  return /\/saved(\/|$)/.test(location.pathname);
}

function syncLibraryToRoute(): void {
  if (isSavedRoute()) {
    if (!isLibraryMounted()) mountLibrary();
  } else if (isLibraryMounted()) {
    unmountLibrary();
  }
}

/**
 * Instagram is a single-page app, so there is no navigation event to hook. Patch the
 * history methods (they fire nothing by spec) and listen for popstate.
 */
function watchRouteChanges(): void {
  let lastPath = location.pathname;

  const check = (): void => {
    if (location.pathname === lastPath) return;
    lastPath = location.pathname;
    syncLibraryToRoute();
  };

  for (const method of ['pushState', 'replaceState'] as const) {
    const original = history[method];
    history[method] = function patched(this: History, ...args: Parameters<History['pushState']>) {
      const result = original.apply(this, args);
      queueMicrotask(check);
      return result;
    };
  }
  window.addEventListener('popstate', check);

  // Belt and braces: some client-side routes swap content without touching history.
  setInterval(check, 1000);
}

function whenBodyReady(fn: () => void): void {
  if (document.body) return fn();
  new MutationObserver((_records, observer) => {
    if (!document.body) return;
    observer.disconnect();
    fn();
  }).observe(document.documentElement, { childList: true });
}

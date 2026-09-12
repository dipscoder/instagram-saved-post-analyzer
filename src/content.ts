/**
 * ISOLATED-world content script on instagram.com. Entry point for everything on-page.
 *
 * Runs at document_start so the capture bridge is listening before the MAIN-world patch
 * starts posting. UI work waits for a body to attach to.
 */

import { startBridge } from './capture/bridge';
import { isLibraryMounted, mountLibrary, unmountLibrary } from './page/library';
import { setScrubberSkin, startVideoControls } from './page/video';
import { isSavedRoute } from './routes';
import { send, subscribe, type SafeSettings } from './messaging';

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

  startVideoControls(settings?.scrubberSkin);
  syncLibraryToRoute();
  watchRouteChanges();

  // Keep the video controls in step with the settings toggle without a reload.
  //
  // Over the port, not storage.onChanged: settings live in storage.local, which the
  // worker locks to TRUSTED_CONTEXTS on every wake, and a closed area does not deliver
  // change events to a content script. The listener this replaces could never fire.
  subscribe((msg) => {
    if (msg.type === 'settings') setScrubberSkin(msg.settings.scrubberSkin);
  });
}

function syncLibraryToRoute(): void {
  if (isSavedRoute()) {
    if (!isLibraryMounted()) mountLibrary();
  } else if (isLibraryMounted()) {
    unmountLibrary();
  }
}

/**
 * Instagram is a single-page app, so there is no navigation event to hook.
 *
 * Patching `history.pushState` looks like the answer and is not: DOM wrappers are
 * per-world, so a patch installed here is never the function Instagram's own bundle calls.
 * `popstate` covers back and forward; the poll is what actually catches a click on
 * Instagram's own nav, and is therefore the mechanism rather than the fallback.
 */
const ROUTE_POLL_MS = 400;

function watchRouteChanges(): void {
  let lastPath = location.pathname;

  const check = (): void => {
    if (location.pathname === lastPath) return;
    lastPath = location.pathname;
    syncLibraryToRoute();
  };

  window.addEventListener('popstate', check);
  setInterval(check, ROUTE_POLL_MS);
}

function whenBodyReady(fn: () => void): void {
  if (document.body) return fn();
  new MutationObserver((_records, observer) => {
    if (!document.body) return;
    observer.disconnect();
    fn();
  }).observe(document.documentElement, { childList: true });
}

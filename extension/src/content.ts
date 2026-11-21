/**
 * ISOLATED-world content script on instagram.com. Entry point for everything on-page.
 *
 * Runs at document_start so the capture bridge is listening before the MAIN-world patch
 * starts posting. UI work waits for a body to attach to.
 */

import { startBridge } from './capture/bridge';
import { isPillMounted, mountPill, unmountPill } from './page/pill';
import { setScrubberSkin, startVideoControls } from './page/video';
import { collectionFromPath } from './routes';
import { send, subscribe } from './messaging';
import type { Settings } from './types';

startBridge();

whenBodyReady(() => {
  void boot();
});

async function boot(): Promise<void> {
  let settings: Settings | null = null;
  try {
    settings = await send<Settings>({ type: 'settings:get' });
  } catch {
    // Service worker still waking. Video controls are worth having regardless.
  }

  startVideoControls(settings?.scrubberSkin);
  syncPillToRoute();
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

/** The collection the pill is mounted for, so moving between collections remounts it. */
let mountedFor: string | null = null;

/**
 * Show the pill inside a saved collection and nowhere else — not on the `/saved/`
 * overview, not on the feed. Capture keeps its own, separate fence (`isSavedRoute`).
 */
function syncPillToRoute(): void {
  const collection = collectionFromPath();
  if (collection?.id === mountedFor && isPillMounted()) return;
  if (isPillMounted()) unmountPill();
  mountedFor = null;
  if (collection) {
    mountPill(collection);
    mountedFor = collection.id;
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
    syncPillToRoute();
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

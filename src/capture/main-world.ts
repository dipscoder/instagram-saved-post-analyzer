/**
 * MAIN world, document_start. Its only job is to monkey-patch window.fetch and
 * XMLHttpRequest and post matching response bodies out to the ISOLATED world.
 *
 * Nothing sensitive lives here — Instagram's own scripts share this context and can read
 * anything we define. No API key, no storage access, no chrome.* calls (none available).
 *
 * Two rules, both non-negotiable:
 *   1. Never break the page. Every hook is wrapped; a throw in our code must not surface
 *      to Instagram's callers, and the response body must reach them untouched.
 *   2. Read a clone. Response bodies are single-use streams; consuming the original
 *      would starve the page of its own data.
 */

import { WIRE, type CapturedPayload, type MainWorldMessage } from '../messaging';

/** The URL alone proves this is the saved feed. The whole body can be trusted. */
const SAVED_ENDPOINTS = [/\/api\/v1\/feed\/saved/i, /\/api\/v1\/collections\//i];

/**
 * One endpoint for the entire site — the home feed, explore, a profile grid and the
 * related-posts strip all come back through here. The body has to earn it, and even then
 * only the saved-feed subtree of it is read downstream.
 */
const GRAPHQL_ENDPOINTS = [/\/graphql\/query/i, /\/api\/graphql/i];

function isSavedEndpoint(url: string): boolean {
  return SAVED_ENDPOINTS.some((re) => re.test(url));
}

function urlMatches(url: string): boolean {
  return isSavedEndpoint(url) || GRAPHQL_ENDPOINTS.some((re) => re.test(url));
}

/**
 * Cheap string test before we pay for JSON.parse and a structured-clone postMessage.
 * A saved-feed payload always carries a media code alongside an owner.
 */
function looksLikeMedia(text: string): boolean {
  if (text.length < 200) return false;
  const hasCode = text.includes('"code"') || text.includes('"shortcode"');
  const hasOwner = text.includes('"user"') || text.includes('"owner"');
  return hasCode && hasOwner;
}

/**
 * A JSON key naming the saved feed, holding an object or array. Deliberately the same
 * condition the extractor scopes on, so a payload that passes here is one it can read —
 * this is only here to skip the parse and the postMessage for the other 95% of GraphQL
 * traffic on the page.
 */
const SAVED_HINT = /"[a-z0-9_]*saved[a-z0-9_]*"\s*:\s*[[{]/i;

// The ISOLATED script may attach its listener after we've already seen a response,
// so hold anything captured before the handshake and flush on 'bridge-ready'.
let bridgeReady = false;
const pending: CapturedPayload[] = [];
const MAX_PENDING = 40;

function emit(payload: CapturedPayload): void {
  if (!bridgeReady) {
    if (pending.length < MAX_PENDING) pending.push(payload);
    return;
  }
  post([payload]);
}

function post(payloads: CapturedPayload[]): void {
  const msg: MainWorldMessage = { wire: WIRE, kind: 'captured', payloads };
  window.postMessage(msg, window.location.origin);
}

window.addEventListener('message', (ev) => {
  if (ev.source !== window) return;
  const data = ev.data as { wire?: string; kind?: string } | null;
  if (data?.wire !== WIRE || data.kind !== 'bridge-ready') return;
  bridgeReady = true;
  if (pending.length) {
    post(pending.splice(0, pending.length));
  }
});

function consider(url: string, text: string): void {
  try {
    const trusted = isSavedEndpoint(url);
    if (!trusted && !(looksLikeMedia(text) && SAVED_HINT.test(text))) return;
    emit({ json: JSON.parse(text), trusted });
  } catch {
    // Not JSON, or a payload we can't read. Silently ignore — this is a passive tap.
  }
}

/**
 * A 429 on any instagram.com API call is the signal to stop auto-scrolling immediately.
 * Reported for every API path, not just the saved feed — being throttled anywhere means
 * we are pushing too hard everywhere.
 */
function reportRateLimit(): void {
  const msg: MainWorldMessage = { wire: WIRE, kind: 'rate-limited' };
  window.postMessage(msg, window.location.origin);
}

function isApiUrl(url: string): boolean {
  return /instagram\.com\/(api|graphql)/i.test(url) || url.startsWith('/api/');
}

// --- fetch ------------------------------------------------------------------

const nativeFetch = window.fetch;

window.fetch = function patchedFetch(
  this: unknown,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const promise = nativeFetch.call(this ?? window, input as RequestInfo, init);

  try {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;

    const watch = urlMatches(url);
    const api = isApiUrl(url);

    if (watch || api) {
      promise
        .then((res) => {
          if (res.status === 429 && api) reportRateLimit();
          if (!watch) return;
          // Clone so the page still gets an unread body.
          res
            .clone()
            .text()
            .then((text) => consider(url, text))
            .catch(() => {});
        })
        .catch(() => {});
    }
  } catch {
    // Never let inspection failure change what the page receives.
  }

  return promise;
};

// --- XMLHttpRequest ---------------------------------------------------------

const nativeOpen = XMLHttpRequest.prototype.open;
const nativeSend = XMLHttpRequest.prototype.send;

const urlForXhr = new WeakMap<XMLHttpRequest, string>();

XMLHttpRequest.prototype.open = function patchedOpen(
  this: XMLHttpRequest,
  method: string,
  url: string | URL,
  ...rest: unknown[]
) {
  try {
    urlForXhr.set(this, typeof url === 'string' ? url : url.href);
  } catch {
    /* ignore */
  }
  // eslint-disable-next-line prefer-rest-params
  return (nativeOpen as (...a: unknown[]) => void).apply(this, [method, url, ...rest]);
};

XMLHttpRequest.prototype.send = function patchedSend(
  this: XMLHttpRequest,
  body?: Document | XMLHttpRequestBodyInit | null,
) {
  try {
    const url = urlForXhr.get(this);
    if (url && (urlMatches(url) || isApiUrl(url))) {
      this.addEventListener('loadend', () => {
        try {
          if (this.status === 429 && isApiUrl(url)) reportRateLimit();
          if (!urlMatches(url)) return;
          // responseText throws for responseType 'blob' / 'arraybuffer'.
          if (this.responseType !== '' && this.responseType !== 'text') return;
          consider(url, this.responseText);
        } catch {
          /* ignore */
        }
      });
    }
  } catch {
    /* ignore */
  }
  return nativeSend.call(this, body ?? null);
};

// Announce ourselves so the bridge knows the patch landed and no fallback
// injection is needed.
const ready: MainWorldMessage = { wire: WIRE, kind: 'main-ready' };
window.postMessage(ready, window.location.origin);

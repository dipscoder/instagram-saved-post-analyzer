/**
 * Fallback for the first screenful.
 *
 * The MAIN-world patch attaches at document_start and so normally beats Instagram's
 * bundle, but a bfcache restore or a client-side route change can paint tiles from data
 * that was already in memory — no network call, nothing to intercept. This reads what is
 * on screen so those posts aren't invisible to the index.
 *
 * It yields a thinner record than interception (no duration, no audio track, caption
 * limited to the img alt text), which is exactly why it is a fallback and not the
 * primary path.
 *
 * It is also the bluntest instrument in the pipeline — every post link on the page looks
 * alike — so it is fenced twice: it only runs on the saved route, and only inside the
 * `<main>` element that holds the grid. Reading the whole document meant a profile page's
 * grid and a permalink's "more from this creator" strip were scraped as if they had been
 * saved.
 */

import type { CapturedPost } from '../types';
import { isSavedRoute } from '../routes';
import { parseHashtags } from './extract';

const POST_HREF = /^\/(?:p|reel|tv)\/([A-Za-z0-9_-]{5,})/;

/** Nothing, unless the saved grid is genuinely what is on screen. */
export function scrapeSavedGrid(): CapturedPost[] {
  if (!isSavedRoute()) return [];
  const main = document.querySelector('main');
  return main ? scrape(main) : [];
}

function scrape(root: ParentNode): CapturedPost[] {
  const found = new Map<string, CapturedPost>();

  for (const a of root.querySelectorAll<HTMLAnchorElement>('a[href^="/p/"], a[href^="/reel/"], a[href^="/tv/"]')) {
    const shortcode = POST_HREF.exec(new URL(a.href, location.origin).pathname)?.[1];
    if (!shortcode || found.has(shortcode)) continue;

    const img = a.querySelector('img');
    // Instagram writes a descriptive alt like "Photo by @handle on ... may contain: …".
    const alt = img?.getAttribute('alt') ?? '';

    found.set(shortcode, {
      shortcode,
      permalink: `https://www.instagram.com/p/${shortcode}/`,
      handle: extractHandle(alt),
      caption: '',
      hashtags: parseHashtags(alt),
      // currentSrc is the candidate the browser actually selected from Instagram's
      // srcset. `src` can still be a lazy-loading placeholder or an expired low-res URL.
      thumbnailUrl: img?.currentSrc || img?.getAttribute('src') || '',
      isVideo: Boolean(a.querySelector('svg[aria-label*="Reel" i], svg[aria-label*="Video" i], video')),
      durationSec: null,
      audioTrackName: null,
      altText: alt || null,
      postedAt: null,
    });
  }

  return [...found.values()];
}

function extractHandle(alt: string): string {
  const m = /(?:Photo|Video|Reel|Post)\s+(?:shared\s+)?by\s+@?([A-Za-z0-9._]+)/i.exec(alt);
  return m?.[1] ? `@${m[1]}` : '';
}

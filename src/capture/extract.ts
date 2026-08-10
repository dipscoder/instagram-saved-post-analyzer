/**
 * Turns an arbitrary Instagram JSON payload into CapturedPost records.
 *
 * The URL matcher decides *whether* to look at a payload; this decides *what counts*.
 * That split is deliberate: Instagram ships the saved feed as REST (`items[].media`) and
 * as GraphQL (`data.xdt_api__v1__feed__saved__posts.edges[].node.media`) depending on the
 * route, and renames the GraphQL field periodically. Rather than track those shapes, we
 * walk the whole tree and pick out anything that looks like a media item — a node with a
 * post code and an owner. That holds across both shapes and survives renames.
 *
 * ## Scope
 *
 * Walking the whole tree is right when the payload is *known* to be the saved feed, and
 * badly wrong otherwise: Instagram answers the home feed, explore, a profile grid and the
 * related-posts strip on the same GraphQL endpoint, and each of those is full of media
 * nodes the user never saved. Indexing them is wrong twice over — a library full of posts
 * you don't recognise, paid for by the caption.
 *
 * So a GraphQL body is walked under `'saved'` scope: only subtrees hanging off a key that
 * *names* the saved feed are collected. That is one narrow assumption — Instagram's
 * codegen'd field names describe what they return, and have through every rename we have
 * seen (`edge_saved_media`, `xdt_api__v1__feed__saved__posts`) — and it is the only place
 * in the pipeline that assumes anything about naming. The REST saved and collection paths
 * prove themselves by URL and are walked whole.
 */

import type { CapturedPost } from '../types';

type Json = Record<string, unknown>;

const MAX_DEPTH = 12;
const MAX_NODES = 20_000;

/**
 * `'any'` — the payload is already known to be the saved feed; take every media node.
 * `'saved'` — take only what hangs off a saved-feed container.
 */
export type Scope = 'any' | 'saved';

/** Matches `edge_saved_media`, `xdt_api__v1__feed__saved__posts`, `saved_posts`, … */
const SAVED_CONTAINER = /saved/i;

export function extractPosts(payload: unknown, scope: Scope = 'any'): CapturedPost[] {
  const found = new Map<string, CapturedPost>();
  for (const root of scope === 'saved' ? savedContainers(payload) : [payload]) {
    collect(root, found);
  }
  return [...found.values()];
}

/**
 * Every value held under a key naming the saved feed. Booleans like `has_viewer_saved`
 * are skipped by the object/array test, and an id list like `saved_collection_ids` is
 * collected but yields nothing — neither contains a media node.
 */
function savedContainers(payload: unknown): unknown[] {
  const roots: unknown[] = [];
  let visited = 0;

  const walk = (node: unknown, depth: number): void => {
    if (node === null || typeof node !== 'object' || depth > MAX_DEPTH) return;
    if (++visited > MAX_NODES) return;

    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }

    for (const [key, value] of Object.entries(node as Json)) {
      if (value !== null && typeof value === 'object' && SAVED_CONTAINER.test(key)) {
        // Everything below a saved container counts; no need to look for another inside.
        roots.push(value);
        continue;
      }
      walk(value, depth + 1);
    }
  };

  walk(payload, 0);
  return roots;
}

function collect(payload: unknown, found: Map<string, CapturedPost>): void {
  let visited = 0;

  const walk = (node: unknown, depth: number): void => {
    if (node === null || typeof node !== 'object' || depth > MAX_DEPTH) return;
    if (++visited > MAX_NODES) return;

    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }

    const obj = node as Json;
    if (isMediaNode(obj)) {
      const post = toCapturedPost(obj);
      // First writer wins: an outer node carries richer fields than a nested repost stub.
      if (post && !found.has(post.shortcode)) found.set(post.shortcode, post);
      // Keep descending regardless — carousels nest children that are media too, and a
      // saved-feed envelope nests the real item under `media`.
    }

    for (const key in obj) walk(obj[key], depth + 1);
  };

  walk(payload, 0);
}

function isMediaNode(o: Json): boolean {
  const code = o['code'] ?? o['shortcode'];
  if (typeof code !== 'string' || code.length < 5) return false;
  // An owner distinguishes a post from, say, a country or currency `code` field.
  return isObj(o['user']) || isObj(o['owner']);
}

function toCapturedPost(o: Json): CapturedPost | null {
  const shortcode = str(o['code']) ?? str(o['shortcode']);
  if (!shortcode) return null;

  const owner = (asObj(o['user']) ?? asObj(o['owner'])) as Json;
  const handle = str(owner['username']) ?? '';
  const caption = readCaption(o);

  return {
    shortcode,
    permalink: `https://www.instagram.com/p/${shortcode}/`,
    handle: handle ? `@${handle}` : '',
    caption,
    hashtags: parseHashtags(caption),
    thumbnailUrl: smallestThumbnail(o) ?? '',
    isVideo: readIsVideo(o),
    durationSec: num(o['video_duration']) ?? num(o['video_duration_seconds']) ?? null,
    audioTrackName: readAudioTrack(o),
    altText: str(o['accessibility_caption']) ?? null,
    savedAt: readTimestamp(o),
  };
}

function readCaption(o: Json): string {
  // REST: { caption: { text } }. Older GraphQL: edge_media_to_caption.edges[0].node.text.
  const capObj = asObj(o['caption']);
  const direct = capObj ? str(capObj['text']) : str(o['caption']);
  if (direct) return direct;

  const edges = asObj(o['edge_media_to_caption'])?.['edges'];
  if (Array.isArray(edges)) {
    const first = asObj(edges[0]);
    const node = first ? asObj(first['node']) : null;
    const text = node ? str(node['text']) : null;
    if (text) return text;
  }
  return '';
}

function readIsVideo(o: Json): boolean {
  if (typeof o['is_video'] === 'boolean') return o['is_video'];
  // media_type: 1 image, 2 video, 8 carousel.
  if (num(o['media_type']) === 2) return true;
  const typename = str(o['__typename']) ?? '';
  return /video|clips|reel/i.test(typename);
}

function readTimestamp(o: Json): number | null {
  const secs =
    num(o['taken_at']) ?? num(o['taken_at_timestamp']) ?? num(o['device_timestamp']);
  if (secs === null) return null;
  // Instagram sends seconds; device_timestamp is occasionally microseconds.
  if (secs > 1e14) return Math.round(secs / 1000);
  if (secs > 1e11) return Math.round(secs);
  return Math.round(secs * 1000);
}

function readAudioTrack(o: Json): string | null {
  const clips = asObj(o['clips_metadata']);
  const music = clips ? asObj(clips['music_info']) : null;
  const asset = music ? asObj(music['music_asset_info']) : null;
  if (asset) {
    const title = str(asset['title']);
    const artist = str(asset['display_artist']);
    if (title) return artist ? `${title} — ${artist}` : title;
  }
  const original = clips ? asObj(clips['original_sound_info']) : null;
  if (original) {
    const name = str(original['original_audio_title']);
    if (name) return name;
  }
  return null;
}

/**
 * Smallest candidate wins. This URL feeds both the grid and the vision fallback, and
 * image tokens dominate model cost — a 150px thumbnail is enough to tell a recipe from
 * a gym reel, and enough for a 4-up card.
 */
function smallestThumbnail(o: Json): string | null {
  const candidates: { url: string; area: number }[] = [];

  const iv2 = asObj(o['image_versions2']);
  const list = iv2 ? iv2['candidates'] : undefined;
  if (Array.isArray(list)) {
    for (const c of list) {
      const cand = asObj(c);
      if (!cand) continue;
      const url = str(cand['url']);
      if (!url) continue;
      const w = num(cand['width']) ?? 0;
      const h = num(cand['height']) ?? 0;
      candidates.push({ url, area: w * h || Number.MAX_SAFE_INTEGER });
    }
  }

  if (candidates.length) {
    candidates.sort((a, b) => a.area - b.area);
    return candidates[0]!.url;
  }

  return (
    str(o['thumbnail_src']) ??
    str(o['display_url']) ??
    str(o['thumbnail_url']) ??
    null
  );
}

export function parseHashtags(caption: string): string[] {
  const out = new Set<string>();
  for (const m of caption.matchAll(/#([\p{L}\p{N}_]+)/gu)) {
    const tag = m[1]?.toLowerCase();
    if (tag) out.add(tag);
  }
  return [...out];
}

// --- narrow helpers ---------------------------------------------------------

function isObj(v: unknown): boolean {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asObj(v: unknown): Json | null {
  return isObj(v) ? (v as Json) : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return null;
}

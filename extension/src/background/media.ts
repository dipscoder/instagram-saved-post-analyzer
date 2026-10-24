/**
 * Thumbnail downloads, shared by vision categorisation and the account's thumbnail copy.
 *
 * The URL came out of a payload the page could have written. Three bounds, because a bare
 * fetch of an attacker-chosen URL is an outbound request from the user's browser, an
 * unbounded response is a service worker running out of memory, and a hung one is a run
 * that never finishes. No cookies go with it: the CDN is cross-origin to the worker.
 */

const MAX_THUMBNAIL_BYTES = 8 * 1024 * 1024;
const THUMBNAIL_TIMEOUT_MS = 15_000;

/**
 * Rejects with a TypeError when the network is down, which callers treat as "try again
 * later", and with a plain Error when the image itself is unusable (an expired signed URL
 * answers 403), which is final for that URL.
 */
export async function fetchThumbnail(url: string): Promise<Blob> {
  if (!isInstagramCdn(url)) throw new Error('Thumbnail is not on an Instagram CDN.');

  const res = await fetch(url, { signal: AbortSignal.timeout(THUMBNAIL_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Thumbnail fetch failed: ${res.status}`);

  const declared = Number(res.headers.get('content-length') ?? '0');
  if (declared > MAX_THUMBNAIL_BYTES) throw new Error('Thumbnail too large.');

  const buffer = await res.arrayBuffer();
  if (buffer.byteLength > MAX_THUMBNAIL_BYTES) throw new Error('Thumbnail too large.');
  const type = (res.headers.get('content-type') ?? 'image/jpeg').split(';')[0]!;
  return new Blob([buffer], { type });
}

/** Matches host_permissions. A thumbnail from anywhere else is not ours to fetch. */
export function isInstagramCdn(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return (
      protocol === 'https:' &&
      (hostname.endsWith('.cdninstagram.com') || hostname.endsWith('.fbcdn.net'))
    );
  } catch {
    return false;
  }
}

/** Long edge of a stored thumbnail: sharp on a grid tile, about 30 KB as JPEG. */
const STORED_EDGE_PX = 480;

/** Re-encodes an image as a JPEG no larger than STORED_EDGE_PX on its long edge. */
export async function shrinkToJpeg(image: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(image);
  const scale = Math.min(1, STORED_EDGE_PX / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not draw the thumbnail.');
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
}

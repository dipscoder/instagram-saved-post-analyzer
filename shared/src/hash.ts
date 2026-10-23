/**
 * A short, stable, non-cryptographic digest of a string.
 *
 * This is a cache key, not a security primitive: its whole job is to answer "is this the
 * same input as last time?" cheaply and identically in the service worker and in
 * `npm run verify`. `crypto.subtle.digest` would be the stronger answer and is the wrong
 * one here — it is async, which would force every call site that wants to ask a question
 * about a stored record to become async too, and it is unavailable in the plain Node
 * process the verify harness runs in.
 *
 * FNV-1a, run over two independently-seeded 32-bit lanes and concatenated. One lane
 * collides at around 2^16 distinct inputs by the birthday bound, which is well inside the
 * range a large library reaches; two lanes push that to 2^32 and the question stops
 * mattering. `Math.imul` keeps the multiply in 32-bit integer space, which is both correct
 * and roughly an order of magnitude faster than letting the value go through a double.
 */

const PRIME = 0x01000193;

function lane(text: string, seed: number): number {
  let h = seed;
  for (let i = 0; i < text.length; i++) {
    // charCodeAt, not codePointAt: astral characters contribute both surrogate halves,
    // which is fine for a digest and avoids a second pass to widen the iteration.
    h = Math.imul(h ^ text.charCodeAt(i), PRIME);
  }
  // >>> 0 lands the value in the unsigned range so toString(16) never emits a sign.
  return h >>> 0;
}

/** 16 lowercase hex characters. Stable across builds, platforms and runs. */
export function hashText(text: string): string {
  const a = lane(text, 0x811c9dc5);
  const b = lane(text, 0x9e3779b9);
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

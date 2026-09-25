/**
 * Compact embedding storage. Gemini returns 768 float32 values per chunk;
 * as JSON that is ~6 KB. We L2-normalise, quantise each component to int8
 * and base64-encode: 1,024 characters per chunk (about 6x smaller) with
 * negligible ranking loss, because cosine similarity of unit vectors is a
 * dot product and a common scale factor never changes the ranking.
 *
 * Isomorphic: runs in the browser and in Node (btoa/atob are global in both).
 */

export const EMBEDDING_DIMS = 768;
export const QUANTIZED_LENGTH = 1024; // base64 length of 768 bytes
export const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

export function normalize(v: ArrayLike<number>): Float32Array {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  const norm = Math.sqrt(sum) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
  return out;
}

export function quantize(v: ArrayLike<number>): string {
  const unit = normalize(v);
  const bytes = new Uint8Array(unit.length);
  for (let i = 0; i < unit.length; i++) {
    const q = Math.max(-127, Math.min(127, Math.round(unit[i] * 127)));
    bytes[i] = q & 0xff;
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function dequantize(encoded: string): Int8Array {
  const binary = atob(encoded);
  const out = new Int8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = (binary.charCodeAt(i) << 24) >> 24;
  return out;
}

/** Cosine similarity between a unit float query and a quantised unit vector. */
export function dotQuantized(query: Float32Array, vector: Int8Array): number {
  if (query.length !== vector.length) return 0;
  let dot = 0;
  for (let i = 0; i < query.length; i++) dot += query[i] * vector[i];
  return dot / 127;
}

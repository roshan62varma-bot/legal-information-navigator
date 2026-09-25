import "server-only";

/**
 * The search index (quantised embeddings) is computed on the server but held
 * by the browser, because the app stores nothing. To stop a client from
 * forging or swapping vectors to steer retrieval, the server signs
 * HMAC-SHA256(documentId || sha256(vectors)) and verifies it on every
 * question. Verification uses crypto.subtle.verify (constant-time).
 *
 * Key: INDEX_SIGNING_SECRET when set, otherwise derived from the Gemini key
 * with a fixed label, so every serverless instance agrees without extra config.
 */

const encoder = new TextEncoder();
let keyPromise: Promise<CryptoKey> | null = null;

function secretMaterial(): string {
  const secret = process.env.INDEX_SIGNING_SECRET ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!secret) throw new Error("No signing secret available");
  return secret;
}

async function signingKey(): Promise<CryptoKey> {
  if (!keyPromise) {
    keyPromise = (async () => {
      const base = await crypto.subtle.importKey("raw", encoder.encode(secretMaterial()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      const derived = await crypto.subtle.sign("HMAC", base, encoder.encode("legal-navigator/index-signing/v1"));
      return crypto.subtle.importKey("raw", derived, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
    })();
  }
  return keyPromise;
}

function toBase64Url(bytes: ArrayBuffer): string {
  let binary = "";
  const view = new Uint8Array(bytes);
  for (let i = 0; i < view.length; i++) binary += String.fromCharCode(view[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const binary = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function message(documentId: string, vectors: readonly string[]): Promise<Uint8Array<ArrayBuffer>> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(vectors.join("\n")));
  const prefix = encoder.encode(`${documentId}.`);
  const bytes = new Uint8Array(new ArrayBuffer(prefix.length + digest.byteLength));
  bytes.set(prefix, 0);
  bytes.set(new Uint8Array(digest), prefix.length);
  return bytes;
}

export async function signIndex(documentId: string, vectors: readonly string[]): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await signingKey(), await message(documentId, vectors));
  return toBase64Url(sig);
}

export async function verifyIndex(documentId: string, vectors: readonly string[], signature: string): Promise<boolean> {
  try {
    return await crypto.subtle.verify("HMAC", await signingKey(), fromBase64Url(signature), await message(documentId, vectors));
  } catch {
    return false;
  }
}

/** Test seam: forget the cached key after changing env vars. */
export function __resetSigningKey(): void {
  keyPromise = null;
}

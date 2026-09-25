import { beforeEach, describe, expect, it } from "vitest";
import { AskRequestSchema, IngestRequestSchema, SummarizeRequestSchema } from "@/types/legal";
import { buildCsp, createNonce, isCrossSiteRequest } from "@/lib/security";
import { dequantize, dotQuantized, normalize, quantize, QUANTIZED_LENGTH } from "@/lib/vector";
import { cosineSimilarity } from "@/lib/retrieval";
import { ApiRouteError, parseBody, readBodyLimited } from "@/lib/server/http";
import { __resetSigningKey, signIndex, verifyIndex } from "@/lib/server/signing";

// ---------------------------------------------------------------------------
// Content Security Policy
// ---------------------------------------------------------------------------

describe("CSP", () => {
  it("allows scripts only by per-request nonce in production", () => {
    const csp = buildCsp("abc123", false);
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("connect-src 'self' blob:");
    expect(csp).toContain("upgrade-insecure-requests");
  });

  it("creates unpredictable nonces", () => {
    const a = createNonce();
    const b = createNonce();
    expect(a).not.toBe(b);
    expect(atob(a)).toHaveLength(16);
  });
});

// ---------------------------------------------------------------------------
// Cross-site API protection
// ---------------------------------------------------------------------------

describe("cross-site request guard", () => {
  const own = "https://navigator.example";
  const h = (init: Record<string, string>) => new Headers(init);

  it("allows same-origin browser calls", () => {
    expect(isCrossSiteRequest(h({ "sec-fetch-site": "same-origin", origin: own }), own)).toBe(false);
  });
  it("blocks other sites from spending the API quota", () => {
    expect(isCrossSiteRequest(h({ "sec-fetch-site": "cross-site" }), own)).toBe(true);
    expect(isCrossSiteRequest(h({ "sec-fetch-site": "same-site" }), own)).toBe(true);
    expect(isCrossSiteRequest(h({ origin: "https://evil.example" }), own)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Request parsing: size caps, media type, strict schemas
// ---------------------------------------------------------------------------

function streamedRequest(bytes: number, headers: Record<string, string> = {}) {
  const chunk = new Uint8Array(64 * 1024).fill(120);
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (sent >= bytes) return c.close();
      c.enqueue(chunk);
      sent += chunk.length;
    },
  });
  return new Request("https://x/api", { method: "POST", body, headers, duplex: "half" } as RequestInit);
}

describe("request body limits", () => {
  it("stops reading a body without Content-Length once it exceeds the cap", async () => {
    await expect(readBodyLimited(streamedRequest(5_000_000), 1_000_000)).rejects.toMatchObject({ status: 413 });
  });
  it("rejects a declared Content-Length over the cap before reading", async () => {
    await expect(readBodyLimited(streamedRequest(10, { "content-length": "9999999" }), 1000)).rejects.toMatchObject({ status: 413 });
  });
  it("rejects non-JSON media types and invalid UTF-8", async () => {
    const form = new Request("https://x", { method: "POST", body: "a=b", headers: { "content-type": "application/x-www-form-urlencoded" } });
    await expect(parseBody(form, IngestRequestSchema)).rejects.toMatchObject({ status: 415 });
    const bad = new Request("https://x", { method: "POST", body: new Uint8Array([0x7b, 0xff, 0x7d]), headers: { "content-type": "application/json" } });
    await expect(parseBody(bad, IngestRequestSchema)).rejects.toBeInstanceOf(ApiRouteError);
  });
});

describe("strict request schemas", () => {
  const doc = { documentId: "doc_0123456789abcdef", name: "a", pages: [{ page: 1, text: "x" }] };
  it("reject unknown keys (mass-assignment style payloads)", () => {
    expect(SummarizeRequestSchema.safeParse({ documentId: doc.documentId, document: doc }).success).toBe(true);
    expect(SummarizeRequestSchema.safeParse({ documentId: doc.documentId, document: doc, admin: true }).success).toBe(false);
    expect(SummarizeRequestSchema.safeParse({ documentId: doc.documentId, document: { ...doc, extra: 1 } }).success).toBe(false);
  });
  it("never accepts chunk text from the client for Q&A", () => {
    const chunks = [{ id: "c1", page: 1, endPage: 1, section: "s", text: "forged clause", tokenEstimate: 2 }];
    expect(AskRequestSchema.safeParse({ documentId: doc.documentId, document: doc, query: "What is it?", index: null, chunks }).success).toBe(false);
    expect(AskRequestSchema.safeParse({ documentId: doc.documentId, document: doc, query: "What is it?", index: null }).success).toBe(true);
  });
  it("validates the shape of index vectors and signatures", () => {
    const base = { documentId: doc.documentId, document: doc, query: "What is it?" };
    const vector = quantize(new Array(768).fill(1));
    expect(AskRequestSchema.safeParse({ ...base, index: { vectors: [vector], signature: "x".repeat(43) } }).success).toBe(true);
    expect(AskRequestSchema.safeParse({ ...base, index: { vectors: ["short"], signature: "x".repeat(43) } }).success).toBe(false);
    expect(AskRequestSchema.safeParse({ ...base, index: { vectors: [vector], signature: "<script>" } }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// HMAC-signed search index
// ---------------------------------------------------------------------------

describe("index signing", () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = "test-key";
    delete process.env.INDEX_SIGNING_SECRET;
    __resetSigningKey();
  });
  const vectors = [quantize([1, 2, 3]), quantize([3, 2, 1])];

  it("verifies its own signature and rejects any change", async () => {
    const sig = await signIndex("doc_aaaaaaaaaaaaaaaa", vectors);
    expect(sig).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await verifyIndex("doc_aaaaaaaaaaaaaaaa", vectors, sig)).toBe(true);
    expect(await verifyIndex("doc_bbbbbbbbbbbbbbbb", vectors, sig)).toBe(false);
    expect(await verifyIndex("doc_aaaaaaaaaaaaaaaa", [...vectors].reverse(), sig)).toBe(false);
    expect(await verifyIndex("doc_aaaaaaaaaaaaaaaa", vectors, "not-a-signature")).toBe(false);
  });

  it("depends on the server secret", async () => {
    const sig = await signIndex("doc_aaaaaaaaaaaaaaaa", vectors);
    process.env.INDEX_SIGNING_SECRET = "another-secret";
    __resetSigningKey();
    expect(await verifyIndex("doc_aaaaaaaaaaaaaaaa", vectors, sig)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Efficiency: quantised embeddings
// ---------------------------------------------------------------------------

describe("int8 embedding quantisation", () => {
  const rand = (seed: number) => Array.from({ length: 768 }, (_, i) => Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453 % 1);

  it("encodes a 768-dim vector in 1,024 characters (vs ~6 KB as JSON floats)", () => {
    const v = rand(1);
    const encoded = quantize(v);
    expect(encoded).toHaveLength(QUANTIZED_LENGTH);
    expect(JSON.stringify(v).length / encoded.length).toBeGreaterThan(5);
  });

  it("keeps cosine similarity within 0.01 of full precision", () => {
    for (let s = 1; s <= 20; s++) {
      const a = rand(s);
      const b = rand(s + 100);
      const exact = cosineSimilarity(a, b);
      const approx = dotQuantized(normalize(a), dequantize(quantize(b)));
      expect(Math.abs(exact - approx)).toBeLessThan(0.01);
    }
  });

  it("preserves the ranking of candidates", () => {
    const query = rand(7);
    const docs = Array.from({ length: 30 }, (_, i) => rand(200 + i).map((x, j) => x + (i % 5) * query[j] * 0.3));
    const exact = docs.map((d) => cosineSimilarity(query, d));
    const approx = docs.map((d) => dotQuantized(normalize(query), dequantize(quantize(d))));
    const top = (xs: number[]) => xs.map((x, i) => [x, i]).sort((p, q) => q[0] - p[0]).slice(0, 5).map((p) => p[1]);
    expect(top(approx)).toEqual(top(exact));
  });
});

// ---------------------------------------------------------------------------
// Efficiency: model circuit breaker
// ---------------------------------------------------------------------------

describe("model circuit breaker", async () => {
  const { __resetModelHealth, cooldownFor, markModelFailure, modelChain } = await import("@/lib/server/gemini");

  it("classifies failures into cooldowns", () => {
    expect(cooldownFor("gemini-x: 404 model not found")).toBe(600_000);
    expect(cooldownFor("gemini-x: 429 quota exceeded")).toBe(60_000);
    expect(cooldownFor("gemini-x: timeout")).toBe(30_000);
    expect(cooldownFor("gemini-x: 400 bad request")).toBe(0);
  });

  it("skips a model during its cooldown and restores it afterwards", () => {
    __resetModelHealth();
    const now = 1_000_000;
    const [first, second] = modelChain("deep", now);
    markModelFailure(first, "429 quota", now);
    expect(modelChain("deep", now + 1_000)[0]).toBe(second);
    expect(modelChain("deep", now + 61_000)[0]).toBe(first);
  });

  it("never returns an empty chain", () => {
    __resetModelHealth();
    const now = 2_000_000;
    for (const id of modelChain("lite", now)) markModelFailure(id, "503 overloaded", now);
    expect(modelChain("lite", now + 1).length).toBeGreaterThan(0);
  });
});

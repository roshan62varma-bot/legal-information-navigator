import { describe, expect, it, vi } from "vitest";
import type { DocumentChunk } from "@/types/legal";
import { bm25Scores, cosineSimilarity, hybridSearch, rerank } from "@/lib/retrieval";
import { dequantize, quantize } from "@/lib/vector";
import { excerptCoverage, faithfulness, verifyAndRepairCitation, verifyCitation } from "@/lib/grounding";
import { findExcerptRange } from "@/lib/highlight";
import { checkRateLimit, __resetRateLimits } from "@/lib/server/rate-limit";

const vec = (...xs: number[]) => {
  const v = new Array(768).fill(0);
  xs.forEach((x, i) => (v[i] = x));
  return v;
};

const chunk = (id: string, text: string, page = 1): DocumentChunk => ({
  id,
  page,
  endPage: page,
  section: id,
  text,
  tokenEstimate: 10,
});

describe("vector math", () => {
  it("computes cosine similarity", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([1, 1], [-1, -1])).toBeCloseTo(-1);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
    expect(cosineSimilarity([1], [1, 2])).toBe(0);
  });

  it("scores BM25 by term relevance with stemming", () => {
    const s = bm25Scores("termination notice", ["Either party may terminate with notice.", "Payment is due monthly.", "Termination requires 30 days notice."]);
    expect(s[1]).toBe(0);
    expect(s[2]).toBeGreaterThan(s[0]);
  });
});

describe("hybridSearch + rerank", () => {
  const chunks = [
    chunk("c1", "Rent is payable on the first day of each month."),
    chunk("c2", "Either party may terminate this lease with sixty days notice."),
    chunk("c3", "The tenant must keep the premises clean."),
  ];
  // Stored the way the app stores them: int8-quantised, base64, then decoded on the server.
  const vectors = [vec(0, 1), vec(1, 0.1), vec(0.2, 0.2)].map((v) => dequantize(quantize(v)));

  it("fuses vector and keyword rankings", () => {
    const r = hybridSearch(chunks, "how do I terminate the lease", vec(1, 0), vectors, 3);
    expect(r[0].chunk.id).toBe("c2");
    expect(r[0].vectorScore).not.toBeNull();
  });

  it("falls back to keyword-only when embeddings are missing", () => {
    const r = hybridSearch(chunks, "terminate lease notice", null, null, 3);
    expect(r[0].chunk.id).toBe("c2");
    expect(r[0].vectorScore).toBeNull();
  });

  it("keeps only reranked passages above the relevance floor, best first", async () => {
    const candidates = hybridSearch(chunks, "rent terminate clean", vec(0.5, 0.5), vectors, 3);
    const reranker = vi.fn(async () => new Map([["c1", 9], ["c2", 5], ["c3", 1]]));
    const top = await rerank("q", candidates, reranker, { topK: 5, minScore: 4 });
    expect(top.map((t) => t.chunk.id)).toEqual(["c1", "c2"]);
    expect(reranker).toHaveBeenCalledOnce();
  });

  it("survives a failing reranker by keeping fused order", async () => {
    const candidates = hybridSearch(chunks, "terminate", vec(1, 0), vectors, 3);
    const top = await rerank("q", candidates, async () => {
      throw new Error("quota");
    });
    expect(top[0].rerankScore).toBeNull();
    expect(top.length).toBeGreaterThan(0);
  });
});

describe("citation grounding (faithfulness)", () => {
  const pages = [
    { page: 1, text: "1. Term. This Agreement lasts for one (1) year." },
    { page: 2, text: "5. Non-Competition. Consultant shall not engage in any business that competes with Company anywhere in the world." },
  ];

  it("verifies verbatim quotes on the cited page", () => {
    const c = verifyCitation({ page: 2, clause: "5", excerpt: "shall not engage in any business that competes with Company" }, pages);
    expect(c.verified).toBe(true);
  });

  it("rejects invented quotes", () => {
    const c = verifyCitation({ page: 2, clause: "5", excerpt: "Consultant may freely work for any competitor after one month" }, pages);
    expect(c.verified).toBe(false);
  });

  it("repairs a wrong page number when the quote exists elsewhere", () => {
    const c = verifyAndRepairCitation({ page: 7, clause: "1", excerpt: "This Agreement lasts for one (1) year" }, pages);
    expect(c).toMatchObject({ page: 1, verified: true });
  });

  it("tolerates PII placeholders inside quotes", () => {
    expect(excerptCoverage("[NAME_1] shall not engage in any business that competes", "Consultant shall not engage in any business that competes")).toBeGreaterThan(0.6);
  });

  it("passes only when at least one citation is grounded", () => {
    expect(faithfulness([]).passed).toBe(false);
    expect(faithfulness([{ page: 1, clause: "", excerpt: "x", verified: false }]).passed).toBe(false);
    expect(faithfulness([{ page: 1, clause: "", excerpt: "x", verified: true }]).passed).toBe(true);
  });
});

describe("highlighting", () => {
  it("finds an excerpt across whitespace and case differences", () => {
    const hay = "5.  Non-Competition.  Consultant SHALL NOT engage   in any business";
    const r = findExcerptRange(hay, "shall not engage in any business");
    expect(r).not.toBeNull();
    expect(hay.slice(r!.start, r!.end)).toBe("SHALL NOT engage   in any business");
  });

  it("matches around redacted names", () => {
    const hay = "Priya Raman shall indemnify and hold harmless Company from any and all claims";
    const r = findExcerptRange(hay, "[NAME_1] shall indemnify and hold harmless Company");
    expect(hay.slice(r!.start, r!.end)).toBe("shall indemnify and hold harmless Company");
  });
});

describe("sliding-window rate limiter", () => {
  it("allows up to the limit inside the window, then recovers", () => {
    __resetRateLimits();
    const t = 1_000_000;
    for (let i = 0; i < 3; i++) expect(checkRateLimit("k", 3, 1000, t + i).allowed).toBe(true);
    const blocked = checkRateLimit("k", 3, 1000, t + 10);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBe(990);
    expect(checkRateLimit("k", 3, 1000, t + 1001).allowed).toBe(true);
    expect(checkRateLimit("other", 3, 1000, t + 10).allowed).toBe(true);
  });
});

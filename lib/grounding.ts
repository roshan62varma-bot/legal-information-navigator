import type { Citation, Page, VerifiedCitation } from "@/types/legal";

/**
 * Faithfulness checks (RAGAS-style, lightweight): a citation counts only if
 * its excerpt actually appears in the source text on (or next to) the cited
 * page. Placeholder tokens from the PII scrubber are ignored when matching.
 */

export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/\[(?:name|email|phone|address|id|bank|card)_\d+\]/g, " ")
    .replace(/[‹›<>]/g, " ")
    .replace(/[‘’']/g, "")
    .replace(/[“”"]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Share of the excerpt's word 4-grams found in the source (1 = verbatim). */
export function excerptCoverage(excerpt: string, source: string): number {
  const ex = normalizeForMatch(excerpt).split(" ").filter(Boolean);
  const src = ` ${normalizeForMatch(source)} `;
  if (ex.length === 0) return 0;
  if (ex.length < 4) return src.includes(` ${ex.join(" ")} `) ? 1 : 0;
  let hit = 0;
  let total = 0;
  for (let i = 0; i + 4 <= ex.length; i++) {
    total += 1;
    if (src.includes(` ${ex.slice(i, i + 4).join(" ")} `)) hit += 1;
  }
  return hit / total;
}

export const COVERAGE_THRESHOLD = 0.6;

export function verifyCitation(c: Citation, pages: readonly Page[]): VerifiedCitation {
  const near = pages.filter((p) => Math.abs(p.page - c.page) <= 1);
  const verified = near.some((p) => excerptCoverage(c.excerpt, p.text) >= COVERAGE_THRESHOLD);
  return { ...c, verified };
}

/** If the model got the page wrong but the quote is real, correct the page number. */
export function verifyAndRepairCitation(c: Citation, pages: readonly Page[]): VerifiedCitation {
  const direct = verifyCitation(c, pages);
  if (direct.verified) return direct;
  let best: { page: number; score: number } | null = null;
  for (const p of pages) {
    const score = excerptCoverage(c.excerpt, p.text);
    if (score >= COVERAGE_THRESHOLD && (!best || score > best.score)) best = { page: p.page, score };
  }
  return best ? { ...c, page: best.page, verified: true } : direct;
}

export function verifyCitations(cs: readonly Citation[], pages: readonly Page[]): VerifiedCitation[] {
  return cs.map((c) => verifyAndRepairCitation(c, pages));
}

export type FaithfulnessResult = {
  verifiedCitations: number;
  totalCitations: number;
  passed: boolean;
};

/** An answer must carry at least one citation that is grounded in the retrieved context. */
export function faithfulness(cs: readonly VerifiedCitation[]): FaithfulnessResult {
  const verified = cs.filter((c) => c.verified).length;
  return { verifiedCitations: verified, totalCitations: cs.length, passed: verified >= 1 };
}
